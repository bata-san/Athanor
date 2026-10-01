import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type * as React from 'react'
import { toast } from 'sonner'
import { ClipboardPaste, Palette } from 'lucide-react'
import type { Board, BoardItem, BoardSummary } from '@/lib/types'
import { api } from '@/lib/api'
import { listen } from '@/lib/events'
import { cssToken } from '@/lib/utils'
import { useAppStore } from '@/lib/store'
import { assetUrl } from '@/lib/asset'
import { arrangeBoardItems, fitBoardView, hitTestBoardItem, screenToWorld, zoomAround } from '@/lib/boardMath'
import { AppIcon } from '@/components/Icons'
import { askConfirm, askText } from '@/components/dialogs'
import { Callout, IconTile } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Tip } from '@/components/ui/tooltip'

type Gesture = { type: 'pan'; x: number; y: number; view: Board['view'] } | { type: 'move'; x: number; y: number; origins: Map<string, { x: number; y: number }> } | { type: 'resize'; id: string; x: number; y: number; w: number; h: number; aspect: number } | { type: 'rotate'; id: string; angle: number; rotation: number } | { type: 'marquee'; x: number; y: number; cx: number; cy: number }
const newText: BoardItem = { id: '', kind: 'text', text: 'A note for later', size: Number(cssToken('--ath-board-text-size')), color: 'var(--foreground)', x: 0, y: 0, w: Number(cssToken('--ath-board-note-width-px')), h: Number(cssToken('--ath-board-note-height-px')), rotation: 0, opacity: 1, flipX: false, grayscale: false, locked: false, z: 0 }
/** Shared look of every floating card that sits on top of the canvas. */
const floatCard = 'absolute z-10 flex items-center gap-1 rounded-xl border border-border bg-popover/95 p-1 shadow-menu backdrop-blur-md'

export default function BoardsPage({ standaloneId = null }: { standaloneId?: string | null }) {
  const snapshot = useAppStore((state) => state.snapshot)
  const [summaries, setSummaries] = useState<BoardSummary[]>([])
  const [board, setBoard] = useState<Board | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [fitSize, setFitSize] = useState({ w: 800, h: 600 })
  const [spaceDown, setSpaceDown] = useState(false)
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const gestureRef = useRef<Gesture | null>(null)
  const saveTimer = useRef<number | null>(null)
  const loadingRef = useRef(false)
  const boardRef = useRef<Board | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const platform = snapshot?.platform ?? 'windows'
  const activeTab = snapshot?.workspace.tabs.find((tab) => tab.id === snapshot.workspace.activeTab)
  const selectedItems = useMemo(() => board?.items.filter((item) => selected.includes(item.id)) ?? [], [board, selected])
  const activeItem = selectedItems.length === 1 ? selectedItems[0]! : null

  const refreshList = useCallback(async () => { const list = await api.listBoards(); setSummaries(list); return list }, [])
  const loadBoard = useCallback(async (id: string) => { loadingRef.current = true; const loaded = await api.getBoard(id); setBoard(loaded); setSelected([]); loadingRef.current = false }, [])
  useEffect(() => { void refreshList().then((list) => { const id = standaloneId && list.some((entry) => entry.id === standaloneId) ? standaloneId : list[0]?.id; if (id) void loadBoard(id) }) }, [refreshList, loadBoard, standaloneId])
  useEffect(() => { boardRef.current = board }, [board])
  useEffect(() => { const unlisten = listen('athanor://board-changed', async ({ id }) => { void refreshList(); if (boardRef.current?.id === id) { const remote = await api.getBoard(id); if (JSON.stringify(remote) !== JSON.stringify(boardRef.current)) setBoard(remote) } }); return () => { void unlisten.then((off) => off()) } }, [refreshList])
  useEffect(() => { const listener = (event: KeyboardEvent) => { if (event.code === 'Space' && !['INPUT', 'TEXTAREA'].includes((event.target as HTMLElement).tagName)) { event.preventDefault(); setSpaceDown(true) }; if ((event.key === 'Delete' || event.key === 'Backspace') && selected.length && board) { setBoard({ ...board, items: board.items.filter((item) => !selected.includes(item.id)) }); setSelected([]) }; if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') void pasteImages() }; const up = (event: KeyboardEvent) => { if (event.code === 'Space') setSpaceDown(false) }; window.addEventListener('keydown', listener); window.addEventListener('keyup', up); return () => { window.removeEventListener('keydown', listener); window.removeEventListener('keyup', up) } }, [selected, board])
  useEffect(() => {
    if (!board || loadingRef.current) return
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => { void api.saveBoard(board); void refreshList() }, 400)
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current) }
  }, [board, refreshList])
  useEffect(() => { const node = canvasRef.current; if (!node) return; const observer = new ResizeObserver(() => setFitSize({ w: node.clientWidth, h: node.clientHeight })); observer.observe(node); return () => observer.disconnect() }, [])

  const updateItems = (fn: (items: BoardItem[]) => BoardItem[]) => setBoard((value) => value ? { ...value, items: fn(value.items) } : value)
  const selectItem = (id: string, shift: boolean) => setSelected((current) => shift ? current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id] : current.includes(id) ? current : [id])
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!board) return
    const box = canvasRef.current!.getBoundingClientRect(), px = event.clientX - box.left, py = event.clientY - box.top
    const isPan = event.button === 1 || spaceDown || (event.button === 0 && (event.target as HTMLElement).classList.contains('board-canvas'))
    if (isPan && (event.button === 1 || spaceDown)) { gestureRef.current = { type: 'pan', x: event.clientX, y: event.clientY, view: board.view }; event.currentTarget.setPointerCapture(event.pointerId); return }
    const world = screenToWorld({ x: px, y: py }, board.view)
    const hit = hitTestBoardItem(board.items, world.x, world.y)
    if (hit) {
      if (!selected.includes(hit.id) || event.shiftKey) selectItem(hit.id, event.shiftKey)
      if (!hit.locked && event.button === 0 && !event.shiftKey) { const ids = selected.includes(hit.id) ? selected : [hit.id]; const origins = new Map(board.items.filter((item) => ids.includes(item.id)).map((item) => [item.id, { x: item.x, y: item.y }])); gestureRef.current = { type: 'move', x: world.x, y: world.y, origins }; event.currentTarget.setPointerCapture(event.pointerId) }
    } else if (event.button === 0 && !event.shiftKey) { setSelected([]); gestureRef.current = { type: 'marquee', x: px, y: py, cx: px, cy: py }; event.currentTarget.setPointerCapture(event.pointerId) }
  }
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current; if (!gesture || !board) return
    if (gesture.type === 'pan') setBoard((value) => value ? { ...value, view: { ...gesture.view, x: gesture.view.x + event.clientX - gesture.x, y: gesture.view.y + event.clientY - gesture.y } } : value)
    if (gesture.type === 'move') { const box = canvasRef.current!.getBoundingClientRect(), world = screenToWorld({ x: event.clientX - box.left, y: event.clientY - box.top }, board.view), dx = world.x - gesture.x, dy = world.y - gesture.y; updateItems((items) => items.map((item) => { const origin = gesture.origins.get(item.id); return origin ? { ...item, x: origin.x + dx, y: origin.y + dy } : item })) }
    if (gesture.type === 'resize') { const dx = (event.clientX - gesture.x) / board.view.zoom, dy = (event.clientY - gesture.y) / board.view.zoom; const w = Math.max(Number(cssToken('--ath-board-min-width-px')), gesture.w + dx), rawH = Math.max(Number(cssToken('--ath-board-min-height-px')), gesture.h + dy); updateItems((items) => items.map((item) => item.id === gesture.id ? { ...item, w, h: event.shiftKey ? w / gesture.aspect : rawH } : item)) }
    if (gesture.type === 'rotate') { const rect = canvasRef.current!.getBoundingClientRect(), world = screenToWorld({ x: event.clientX - rect.left, y: event.clientY - rect.top }, board.view), item = board.items.find((entry) => entry.id === gesture.id); if (item) { const center = { x: item.x + item.w / 2, y: item.y + item.h / 2 }; updateItems((items) => items.map((entry) => entry.id === gesture.id ? { ...entry, rotation: gesture.rotation + Math.atan2(world.y - center.y, world.x - center.x) * 180 / Math.PI - gesture.angle } : entry)) } }
    if (gesture.type === 'marquee') { const cx = event.clientX - canvasRef.current!.getBoundingClientRect().left, cy = event.clientY - canvasRef.current!.getBoundingClientRect().top; gesture.cx = cx; gesture.cy = cy; setMarquee({ x: Math.min(gesture.x, cx), y: Math.min(gesture.y, cy), w: Math.abs(cx - gesture.x), h: Math.abs(cy - gesture.y) }); const a = screenToWorld({ x: Math.min(gesture.x, cx), y: Math.min(gesture.y, cy) }, board.view), b = screenToWorld({ x: Math.max(gesture.x, cx), y: Math.max(gesture.y, cy) }, board.view); setSelected(board.items.filter((item) => item.x + item.w >= a.x && item.x <= b.x && item.y + item.h >= a.y && item.y <= b.y).map((item) => item.id)) }
  }
  const onPointerUp = () => { gestureRef.current = null; setMarquee(null) }
  const onWheel = (event: React.WheelEvent) => { if (!board) return; event.preventDefault(); const rect = canvasRef.current!.getBoundingClientRect(), screen = { x: event.clientX - rect.left, y: event.clientY - rect.top }; if (event.ctrlKey || event.metaKey) setBoard({ ...board, view: zoomAround(board.view, screen, board.view.zoom * Math.exp(-event.deltaY * 0.002)) }); else setBoard({ ...board, view: { ...board.view, x: board.view.x - event.deltaX, y: board.view.y - event.deltaY } }) }
  const addText = () => { if (!board) return; const id = crypto.randomUUID(); const item = { ...newText, id, x: screenToWorld({ x: fitSize.w / 2, y: fitSize.h / 2 }, board.view).x, y: screenToWorld({ x: fitSize.w / 2, y: fitSize.h / 2 }, board.view).y, z: Math.max(0, ...board.items.map((value) => value.z)) + 1 }; setBoard({ ...board, items: [...board.items, item] }); setSelected([id]) }
  const addImageFile = async (file: File, x?: number, y?: number) => { if (!board || !file.type.startsWith('image/')) return; const data = await fileToBase64(file).catch((error) => { toast.error(why(error)); return null }); if (!data) return; const hash = await api.boardPutAsset(data, file.type).catch((error) => { toast.error(why(error)); return null }); if (!hash) return; const rect = canvasRef.current?.getBoundingClientRect(); const center = screenToWorld({ x: x ?? (rect?.width ?? 0) / 2, y: y ?? (rect?.height ?? 0) / 2 }, board.view); const img = new Image(); img.onload = () => { const maxSize = Number(cssToken('--ath-board-image-max-px')); const ratio = Math.min(1, maxSize / Math.max(img.width, img.height)); const item: BoardItem = { id: crypto.randomUUID(), kind: 'image', asset: hash, mime: file.type, x: center.x, y: center.y, w: img.width * ratio, h: img.height * ratio, rotation: 0, opacity: 1, flipX: false, grayscale: false, locked: false, z: Math.max(0, ...board.items.map((v) => v.z)) + 1 }; setBoard((value) => value ? { ...value, items: [...value.items, item] } : value); setSelected([item.id]) }; img.src = URL.createObjectURL(file) }
  const addImageFiles = async (files: FileList | null) => { if (!files) return; for (const file of [...files]) await addImageFile(file) }
  // Pasting is silent until something lands, so a clipboard that cannot be read says so instead of doing nothing.
  const pasteImages = async () => { try { const items = await navigator.clipboard?.read?.(); if (!items) return; for (const clipboard of items) for (const type of clipboard.types.filter((entry) => entry.startsWith('image/'))) { const blob = await clipboard.getType(type); await addImageFile(new File([blob], 'pasted-image', { type })) } } catch (error) { toast.error(why(error)) } }
  const arrange = () => { if (board) updateItems((items) => arrangeBoardItems(items)) }
  const fitAll = () => { if (board) setBoard({ ...board, view: fitBoardView(board.items, fitSize) }) }
  const createBoard = async () => { const name = await askText({ title: 'New board', label: 'Name', initial: 'Untitled board', confirm: 'Create' }); if (!name) return; try { const created = await api.createBoard(name); await refreshList(); setBoard(created); setSelected([]) } catch (error) { toast.error(why(error)) } }
  const renameBoard = async (entry: BoardSummary) => { const name = await askText({ title: 'Rename board', label: 'Name', initial: entry.name, confirm: 'Rename' }); if (!name) return; try { if (board?.id === entry.id) setBoard({ ...board, name }); else { const loaded = await api.getBoard(entry.id); await api.saveBoard({ ...loaded, name }); void refreshList() } } catch (error) { toast.error(why(error)) } }
  const deleteBoard = async (entry: BoardSummary) => { if (!await askConfirm({ title: `Delete “${entry.name}”?`, description: 'The board and its items are removed.', confirm: 'Delete', destructive: true })) return; try { await api.deleteBoard(entry.id); const list = await refreshList(); if (board?.id === entry.id) { const next = list[0]; setBoard(next ? await api.getBoard(next.id) : null) } } catch (error) { toast.error(why(error)) } }
  const addUrl = async (url: string, x: number, y: number) => { if (!board) return; const world = screenToWorld({ x, y }, board.view); try { await api.boardAddFromUrl(board.id, url, world.x, world.y); await loadBoard(board.id) } catch (error) { toast.error(why(error)) } }
  const capturePage = async () => { if (!activeTab || !board) return; try { await api.sendPageImageToBoard(activeTab.id, board.id); toast.success('Page captured') } catch (error) { toast.error(why(error)) } }
  const openWindow = async () => { if (!board) return; try { await api.openBoardWindow(board.id) } catch (error) { toast.error(why(error)) } }
  const setAlwaysOnTop = (on: boolean) => { if (!board) return; setBoard({ ...board, alwaysOnTop: on }); void api.setBoardAlwaysOnTop(board.id, on).catch((error) => { setBoard((value) => value ? { ...value, alwaysOnTop: !on } : value); toast.error(why(error)) }) }
  const zoomBy = (factor: number) => setBoard((value) => value ? { ...value, view: zoomAround(value.view, { x: fitSize.w / 2, y: fitSize.h / 2 }, value.view.zoom * factor) } : value)

  return <div data-part="board" className="flex h-full min-h-0 w-full">
    {!standaloneId && <aside aria-label="Boards" className="flex w-[var(--ath-board-list-mobile)] shrink-0 flex-col overflow-y-auto border-e border-border bg-sidebar p-2 min-[700px]:w-[var(--ath-board-list-width)]">
      <div className="mb-1 flex h-8 shrink-0 items-center justify-between gap-2 px-1">
        <span className="text-xs font-semibold text-muted-foreground">Boards</span>
        <Tip label="Create board"><Button variant="ghost" size="icon-sm" aria-label="Create board" onClick={() => void createBoard()}><AppIcon name="Plus" /></Button></Tip>
      </div>
      <div className="flex flex-col gap-0.5">
        {summaries.map((entry) => <div key={entry.id} className="group flex items-center gap-0.5">
          <button data-active={String(board?.id === entry.id)} aria-current={board?.id === entry.id ? 'true' : undefined} onClick={() => void loadBoard(entry.id)} className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-start text-sm text-muted-foreground transition-colors outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 data-[active=true]:bg-sidebar-accent data-[active=true]:text-foreground max-md:min-h-11">
            <AppIcon name="PanelsTopLeft" className="size-4 shrink-0" />
            <span className="truncate">{entry.name}</span>
            <Badge variant="outline" className="ms-auto shrink-0 tabular-nums">{entry.itemCount}<span className="sr-only"> {entry.itemCount === 1 ? 'item' : 'items'}</span></Badge>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${entry.name}`} className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 max-md:opacity-100"><AppIcon name="Ellipsis" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-44">
              <DropdownMenuItem onSelect={() => void renameBoard(entry)}><AppIcon name="NotebookPen" />Rename</DropdownMenuItem>
              <DropdownMenuItem destructive onSelect={() => void deleteBoard(entry)}><AppIcon name="Trash2" />Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>)}
      </div>
      {summaries.length === 0 && <p className="px-2 py-1.5 text-[0.8667rem] text-muted-foreground">Create a board to collect references.</p>}
    </aside>}
    <section data-part="board-workspace" className="relative min-w-0 flex-1 overflow-hidden">
      {!board ? <div className="absolute inset-0 grid place-items-center p-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <IconTile icon="PanelsTopLeft" className="size-11 rounded-xl [&_svg]:size-5" />
          <div>
            <h2 className="m-0 text-sm font-semibold">No board selected</h2>
            <p className="m-0 mt-1 text-[0.8667rem] text-muted-foreground">Create a board to collect references, notes and page captures.</p>
          </div>
          <Button onClick={() => void createBoard()}><AppIcon name="Plus" />New Board</Button>
        </div>
      </div> : <>
        <div data-part="board-toolbar" className="absolute left-1/2 top-3 z-10 flex w-max max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-1 rounded-xl border border-border bg-popover/95 p-1 shadow-menu backdrop-blur-md">
          <Input aria-label="Board name" value={board.name} onChange={(event) => setBoard({ ...board, name: event.target.value })} className="h-8 w-[var(--ath-board-name-width)] max-w-[42vw] border-0 bg-transparent px-2 shadow-none max-md:w-28" />
          <Separator orientation="vertical" className="mx-0.5 h-5" />
          <Tip label="Add image"><Button size="icon-sm" variant="ghost" aria-label="Add image" onClick={() => fileRef.current?.click()}><AppIcon name="ImagePlus" /></Button></Tip>
          <Tip label="Add text note"><Button size="icon-sm" variant="ghost" aria-label="Add text note" onClick={addText}><AppIcon name="NotebookPen" /></Button></Tip>
          <Tip label="Paste image"><Button size="icon-sm" variant="ghost" aria-label="Paste image" onClick={() => void pasteImages()}><ClipboardPaste aria-hidden="true" /></Button></Tip>
          {activeTab && <Tip label="Capture current page"><Button size="icon-sm" variant="ghost" aria-label="Capture current page" onClick={() => void capturePage()}><AppIcon name="AppWindow" /></Button></Tip>}
          {platform !== 'android' && <Tip label="Open standalone board window"><Button size="icon-sm" variant="ghost" aria-label="Open standalone board window" onClick={() => void openWindow()}><AppIcon name="SquareArrowOutUpRight" /></Button></Tip>}
          <Separator orientation="vertical" className="mx-0.5 h-5" />
          <Tip label="Arrange items"><Button size="icon-sm" variant="ghost" aria-label="Arrange items" onClick={arrange}><AppIcon name="LayoutDashboard" /></Button></Tip>
          <Tip label="Fit all items"><Button size="icon-sm" variant="ghost" aria-label="Fit all items" onClick={fitAll}><AppIcon name="Maximize2" /></Button></Tip>
          <Separator orientation="vertical" className="mx-0.5 h-5" />
          <Tip label="Flip horizontally"><Button size="icon-sm" variant="ghost" aria-label="Flip horizontally" disabled={!activeItem} onClick={() => updateItems((items) => items.map((item) => item.id === selected[0] ? { ...item, flipX: !item.flipX } : item))}><AppIcon name="ArrowLeftRight" /></Button></Tip>
          <Tip label="Toggle grayscale"><Button size="icon-sm" variant="ghost" aria-label="Toggle grayscale" disabled={!activeItem} onClick={() => updateItems((items) => items.map((item) => item.id === selected[0] ? { ...item, grayscale: !item.grayscale } : item))}><AppIcon name="Moon" /></Button></Tip>
          <Tip label="Lock or unlock"><Button size="icon-sm" variant="ghost" aria-label="Lock or unlock" disabled={!activeItem} onClick={() => updateItems((items) => items.map((item) => item.id === selected[0] ? { ...item, locked: !item.locked } : item))}><AppIcon name="LockKeyhole" /></Button></Tip>
          <Tip label="Bring to front"><Button size="icon-sm" variant="ghost" aria-label="Bring to front" disabled={!activeItem} onClick={() => updateItems((items) => items.map((item) => item.id === selected[0] ? { ...item, z: Math.max(...items.map((value) => value.z)) + 1 } : item))}><AppIcon name="ArrowUp" /></Button></Tip>
          <Tip label="Send backward"><Button size="icon-sm" variant="ghost" aria-label="Send backward" disabled={!activeItem} onClick={() => updateItems((items) => items.map((item) => item.id === selected[0] ? { ...item, z: Math.min(...items.map((value) => value.z)) - 1 } : item))}><AppIcon name="ArrowDown" /></Button></Tip>
          <Tip label="Delete selected"><Button size="icon-sm" variant="ghost" aria-label="Delete selected" disabled={!selected.length} onClick={() => { updateItems((items) => items.filter((item) => !selected.includes(item.id))); setSelected([]) }}><AppIcon name="Trash2" /></Button></Tip>
          <Separator orientation="vertical" className="mx-0.5 h-5" />
          <Tip label="Always on top"><Button size="icon-sm" variant={board.alwaysOnTop ? 'secondary' : 'ghost'} aria-label="Always on top" aria-pressed={board.alwaysOnTop} onClick={() => setAlwaysOnTop(!board.alwaysOnTop)}><AppIcon name="Layers3" /></Button></Tip>
        </div>
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" aria-label="Add image files" onChange={(event) => { void addImageFiles(event.target.files); event.target.value = '' }} />
        <div ref={canvasRef} data-part="board-canvas" className="board-canvas absolute inset-0 touch-none overflow-hidden" style={{ background: board.background || 'var(--ath-board-default)' }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onWheel={onWheel} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const rect = canvasRef.current!.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top; const files = [...event.dataTransfer.files]; for (const file of files) void addImageFile(file, x, y); const uri = (event.dataTransfer.getData('text/uri-list') || event.dataTransfer.getData('text/plain')).trim().split(/\r?\n/).find((line) => line && !line.startsWith('#')); if (uri && /^https?:\/\//i.test(uri)) void addUrl(uri, x, y) }}>
          <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${board.view.x}px, ${board.view.y}px) scale(${board.view.zoom})` }}>{board.items.map((item) => <BoardItemView key={item.id} item={item} selected={selected.includes(item.id)} platform={platform} onText={(text) => updateItems((items) => items.map((value) => value.id === item.id && value.kind === 'text' ? { ...value, text } : value))} onResizeStart={(event) => { event.stopPropagation(); gestureRef.current = { type: 'resize', id: item.id, x: event.clientX, y: event.clientY, w: item.w, h: item.h, aspect: item.w / item.h }; (event.currentTarget.closest('.board-canvas') as HTMLElement | null)?.setPointerCapture(event.pointerId) }} onRotateStart={(event) => { event.stopPropagation(); const rect = canvasRef.current!.getBoundingClientRect(), world = screenToWorld({ x: event.clientX - rect.left, y: event.clientY - rect.top }, board.view), center = { x: item.x + item.w / 2, y: item.y + item.h / 2 }; gestureRef.current = { type: 'rotate', id: item.id, angle: Math.atan2(world.y - center.y, world.x - center.x) * 180 / Math.PI, rotation: item.rotation }; (event.currentTarget.closest('.board-canvas') as HTMLElement | null)?.setPointerCapture(event.pointerId) }} />)}</div>
          {marquee && <div className="pointer-events-none absolute z-10 rounded-sm border border-dashed border-primary/50 bg-primary/5" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />}
          <div className={`${floatCard} bottom-3 left-3`}>
            <Tip label="Zoom out"><Button size="icon-sm" variant="ghost" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.2)}><AppIcon name="Minus" /></Button></Tip>
            <span className="min-w-11 text-center text-[0.8667rem] font-medium tabular-nums text-muted-foreground">{Math.round(board.view.zoom * 100)}%</span>
            <Tip label="Zoom in"><Button size="icon-sm" variant="ghost" aria-label="Zoom in" onClick={() => zoomBy(1.2)}><AppIcon name="Plus" /></Button></Tip>
          </div>
          <div className={`${floatCard} right-3 bottom-3 gap-2 p-1.5`}>
            <span className="text-xs text-muted-foreground">Opacity</span>
            <Slider aria-label="Selected item opacity" aria-valuetext={activeItem ? `${Math.round(activeItem.opacity * 100)}%` : 'No item selected'} min={0.1} max={1} step={0.05} value={[activeItem?.opacity ?? 0]} disabled={!activeItem} onValueChange={([opacity]) => updateItems((items) => items.map((item) => item.id === selected[0] ? { ...item, opacity } : item))} className="w-20" />
            <span className="w-8 text-right text-xs tabular-nums text-muted-foreground">{activeItem ? `${Math.round(activeItem.opacity * 100)}%` : '—'}</span>
            <Separator orientation="vertical" className="mx-0.5 h-6" />
            <Tip label="Canvas background" side="top"><label className="flex size-8 cursor-pointer items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground max-md:size-11"><Palette aria-hidden="true" /><input type="color" aria-label="Board background color" value={board.background.startsWith('#') ? board.background : cssToken('--ath-board-default')} onChange={(event) => setBoard({ ...board, background: event.target.value })} className="size-4 cursor-pointer rounded border-0 bg-transparent p-0" /></label></Tip>
          </div>
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-[6] flex justify-center px-4 max-[1500px]:hidden">
          <Callout className="w-fit max-w-full gap-2 rounded-full bg-popover/85 px-3 py-1.5 text-xs backdrop-blur-sm">
            <AppIcon name="CircleHelp" className="size-3.5 shrink-0" />
            <span className="truncate">Space + drag to pan · Ctrl + wheel to zoom · Shift + click to multi-select · Ctrl+V to paste</span>
          </Callout>
        </div>
      </>}
    </section>
  </div>
}

function BoardItemView({ item, selected, platform, onText, onResizeStart, onRotateStart }: { item: BoardItem; selected: boolean; platform: string; onText: (text: string) => void; onResizeStart: (event: React.PointerEvent<HTMLSpanElement>) => void; onRotateStart: (event: React.PointerEvent<HTMLSpanElement>) => void }) {
  const asset = item.kind === 'image' ? assetUrl(item.asset, platform as 'windows' | 'macos' | 'linux' | 'android' | 'ios') : ''
  return <div data-part="board-item" data-selected={String(selected)} data-locked={String(item.locked)} data-grayscale={String(item.grayscale)} className="absolute origin-center select-none data-[grayscale=true]:[&>img]:grayscale data-[locked=true]:cursor-default data-[selected=true]:outline-solid data-[selected=true]:outline-1 data-[selected=true]:outline-primary data-[selected=true]:outline-offset-2" style={{ left: item.x, top: item.y, width: item.w, height: item.h, opacity: item.opacity, zIndex: item.z, transform: `rotate(${item.rotation}deg) scaleX(${item.flipX ? -1 : 1})` }} onDoubleClick={() => { if (item.kind === 'text') { const next = window.prompt('Edit note', item.text); if (next !== null) onText(next) } }}>
    {item.kind === 'image' ? <img draggable="false" src={asset} alt={item.sourceUrl ? `Reference from ${item.sourceUrl}` : 'Board reference'} className="block size-full rounded-lg object-contain" /> : <textarea aria-label="Text note" value={item.text} onChange={(event) => onText(event.target.value)} className="block size-full resize-none overflow-hidden bg-transparent p-0 whitespace-pre-wrap outline-none" style={{ color: item.color, fontSize: `${item.size}px` }} />}
    {selected && !item.locked && <><span role="button" tabIndex={0} aria-label="Rotate item" onPointerDown={onRotateStart} className="absolute -top-7 left-1/2 grid size-6 -translate-x-1/2 cursor-grab place-items-center rounded-full border border-border bg-popover text-muted-foreground shadow-sm active:cursor-grabbing [&_svg]:size-3"><AppIcon name="RotateCw" /></span><span role="button" tabIndex={0} aria-label="Resize item" onPointerDown={onResizeStart} className="absolute -right-1.5 -bottom-1.5 size-3.5 cursor-nwse-resize rounded-full border-2 border-background bg-primary" /></>}
  </div>
}
function fileToBase64(file: File): Promise<string> { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => { const data = String(reader.result); resolve(data.split(',')[1] ?? '') }; reader.onerror = () => reject(reader.error); reader.readAsDataURL(file) }) }
/** The reason the backend gave, in the words Settings shows. */
function why(error: unknown) { return error instanceof Error ? error.message : String(error) }
