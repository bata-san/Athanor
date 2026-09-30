for (const heading of document.querySelectorAll('h1[id],h2[id],h3[id]')) {
  if (heading.querySelector('.athanor-copy-permalink')) continue;
  const button = document.createElement('button');
  button.className = 'athanor-copy-permalink';
  button.type = 'button';
  button.textContent = 'Copy link';
  button.setAttribute('aria-label', 'Copy heading permalink');
  button.addEventListener('click', () => {
    const link = new URL(location.href);
    link.hash = heading.id;
    navigator.clipboard.writeText(link.href);
  });
  heading.append(button);
}
