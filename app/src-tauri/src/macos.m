// Thin WKWebView adapter. All entry points are called on Tauri's main thread.
// Tauri retains its navigation/UI delegates, so redirects, POSTs and popup openers stay intact.
#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>
#import <objc/runtime.h>

typedef void (*EventCallback)(void *, int, const char *, bool, bool);
typedef void (*ReleaseCallback)(void *);
typedef void (*DataCallback)(void *, const unsigned char *, size_t, const char *);
typedef void (*TextCallback)(void *, const char *);
static char ObserverKey, HistoryKey;
static NSHashTable<WKWebView *> *Views;
static WKContentRuleList *Rules;
static NSString *LastRules;
static NSUInteger RulesGeneration;

@interface AthanorObserver : NSObject
@property(nonatomic, weak) WKWebView *view;
@property(nonatomic) void *context;
@property(nonatomic) EventCallback callback;
@property(nonatomic) ReleaseCallback releaseContext;
@end

@implementation AthanorObserver
- (void)observeValueForKeyPath:(NSString *)key ofObject:(NSObject *)object
                       change:(NSDictionary<NSKeyValueChangeKey, id> *)change context:(void *)context {
    WKWebView *view = self.view;
    if (!view) return;
    if ([key isEqualToString:@"URL"])
        self.callback(self.context, 0, view.URL.absoluteString.UTF8String ?: "", false, false);
    else if ([key isEqualToString:@"title"])
        self.callback(self.context, 1, view.title.UTF8String ?: "", false, false);
    else if ([key isEqualToString:@"loading"])
        self.callback(self.context, 2, "", view.loading, false);
    self.callback(self.context, 3, "", view.canGoBack, view.canGoForward);
}
- (void)dealloc {
    WKWebView *view = self.view;
    if (view) for (NSString *key in @[@"URL", @"title", @"loading", @"canGoBack", @"canGoForward"])
        [view removeObserver:self forKeyPath:key];
    self.releaseContext(self.context);
}
@end

void athanor_attach(void *pointer, void *context, EventCallback callback, ReleaseCallback release) {
    WKWebView *view = (__bridge WKWebView *)pointer;
    if (!Views) Views = [NSHashTable weakObjectsHashTable];
    [Views addObject:view];
    if (Rules) [view.configuration.userContentController addContentRuleList:Rules];
    AthanorObserver *observer = [AthanorObserver new];
    observer.view = view;
    observer.context = context;
    observer.callback = callback;
    observer.releaseContext = release;
    for (NSString *key in @[@"URL", @"title", @"loading", @"canGoBack", @"canGoForward"])
        [view addObserver:observer forKeyPath:key options:0 context:NULL];
    objc_setAssociatedObject(view, &ObserverKey, observer, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
}

void athanor_register(void *pointer) {
    WKWebView *view = (__bridge WKWebView *)pointer;
    if (!Views) Views = [NSHashTable weakObjectsHashTable];
    [Views addObject:view];
    if (Rules) [view.configuration.userContentController addContentRuleList:Rules];
}

void athanor_detach(void *pointer) {
    WKWebView *view = (__bridge WKWebView *)pointer;
    [Views removeObject:view];
    objc_setAssociatedObject(view, &ObserverKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
}

void athanor_action(void *pointer, int action, long long entry) {
    WKWebView *view = (__bridge WKWebView *)pointer;
    switch (action) {
        case 0: [view goBack]; break;
        case 1: [view goForward]; break;
        case 2: [view stopLoading]; break;
        case 3: [view reloadFromOrigin]; break;
        case 4: {
            WKBackForwardList *list = view.backForwardList;
            NSMutableArray<WKBackForwardListItem *> *items = [list.backList mutableCopy];
            if (list.currentItem) [items addObject:list.currentItem];
            [items addObjectsFromArray:list.forwardList];
            for (WKBackForwardListItem *item in items)
                if ([objc_getAssociatedObject(item, &HistoryKey) longLongValue] == entry) {
                    [view goToBackForwardListItem:item]; break;
                }
            break;
        }
    }
}

void athanor_history(void *pointer, void *context, TextCallback callback) {
    WKBackForwardList *list = ((__bridge WKWebView *)pointer).backForwardList;
    NSMutableArray<WKBackForwardListItem *> *items = [list.backList mutableCopy];
    if (list.currentItem) [items addObject:list.currentItem];
    [items addObjectsFromArray:list.forwardList];
    NSMutableArray<NSDictionary *> *entries = [NSMutableArray new];
    static long long nextID = 1;
    for (WKBackForwardListItem *item in items) {
        NSNumber *identifier = objc_getAssociatedObject(item, &HistoryKey);
        if (!identifier) {
            identifier = @(nextID++);
            objc_setAssociatedObject(item, &HistoryKey, identifier, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
        }
        [entries addObject:@{@"id":identifier, @"url":item.URL.absoluteString ?: @"", @"title":item.title ?: @""}];
    }
    NSData *data = [NSJSONSerialization dataWithJSONObject:@{@"currentIndex":@(list.backList.count), @"entries":entries} options:0 error:nil];
    callback(context, [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding].UTF8String ?: "{}");
}

void athanor_snapshot(void *pointer, void *context, DataCallback callback) {
    WKWebView *view = (__bridge WKWebView *)pointer;
    [view takeSnapshotWithConfiguration:nil completionHandler:^(NSImage *image, NSError *error) {
        NSData *tiff = image.TIFFRepresentation;
        NSBitmapImageRep *bitmap = tiff ? [NSBitmapImageRep imageRepWithData:tiff] : nil;
        NSData *png = [bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
        callback(context, png.bytes, png.length, png ? NULL : (error.localizedDescription.UTF8String ?: "Page capture failed"));
    }];
}

void athanor_raise(void *pointer) {
    WKWebView *view = (__bridge WKWebView *)pointer;
    [view.superview addSubview:view positioned:NSWindowAbove relativeTo:nil];
}

void athanor_radius(void *pointer, double radius) {
    WKWebView *view = (__bridge WKWebView *)pointer;
    view.wantsLayer = YES;
    view.layer.cornerRadius = MAX(0, radius);
    view.layer.masksToBounds = radius > 0;
}

void athanor_rules(const char *json, void *context, TextCallback callback) {
    NSString *text = [NSString stringWithUTF8String:json];
    if ([LastRules isEqualToString:text]) { callback(context, ""); return; }
    LastRules = text;
    NSUInteger generation = ++RulesGeneration;
    if ([text isEqualToString:@"[]"]) {
        Rules = nil;
        for (WKWebView *view in Views) [view.configuration.userContentController removeAllContentRuleLists];
        callback(context, ""); return;
    }
    [[WKContentRuleListStore defaultStore] compileContentRuleListForIdentifier:@"athanor-shield"
        encodedContentRuleList:text completionHandler:^(WKContentRuleList *rules, NSError *error) {
        if (generation == RulesGeneration) {
            if (rules) {
                Rules = rules;
                for (WKWebView *view in Views) {
                    [view.configuration.userContentController removeAllContentRuleLists];
                    [view.configuration.userContentController addContentRuleList:rules];
                }
            } else LastRules = nil; // Keep the previously compiled rules and permit a retry.
        }
        callback(context, error.localizedDescription.UTF8String ?: "");
    }];
}
