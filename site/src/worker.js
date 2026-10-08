// Static assets serve whole files; video players (Safari in particular) need byte ranges to start and seek.
// Only the film requests come here first: everything else is served straight from the assets binding.
export default {
  async fetch(request, env) {
    const res = await env.ASSETS.fetch(request);
    const range = request.headers.get('Range');
    if (!range || res.status !== 200) return withRanges(res);
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    const body = await res.arrayBuffer();
    const size = body.byteLength;
    if (!m || (m[1] === '' && m[2] === '')) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    let start = m[1] === '' ? Math.max(0, size - Number(m[2])) : Number(m[1]);
    let end = m[1] !== '' && m[2] !== '' ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    const headers = new Headers(res.headers);
    headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
    headers.set('Content-Length', String(end - start + 1));
    headers.set('Accept-Ranges', 'bytes');
    return new Response(request.method === 'HEAD' ? null : body.slice(start, end + 1), { status: 206, headers });
  },
};

function withRanges(res) {
  const headers = new Headers(res.headers);
  headers.set('Accept-Ranges', 'bytes');
  return new Response(res.body, { status: res.status, headers });
}
