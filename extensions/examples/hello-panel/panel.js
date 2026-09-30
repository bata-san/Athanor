const pending = new Map();
let nextId = 1;
function rpc(method, params = {}) {
  const id = String(nextId++);
  parent.postMessage({ athanor: 1, id, method, params }, '*');
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
addEventListener('message', (event) => {
  if (event.source !== parent || event.data?.athanor !== 1) return;
  const request = pending.get(String(event.data.id));
  if (!request) return;
  pending.delete(String(event.data.id));
  if ('error' in event.data) request.reject(new Error(String(event.data.error)));
  else request.resolve(event.data.result);
});
rpc('tabs.list').then((tabs) => { document.querySelector('#count').textContent = `${tabs.length} tabs open`; });
rpc('storage.get', { key: 'note' }).then((value) => { document.querySelector('#note').value = value || ''; });
document.querySelector('#save').addEventListener('click', async () => {
  await rpc('storage.set', { key: 'note', value: document.querySelector('#note').value });
  await rpc('ui.toast', { message: 'Note saved' });
});
