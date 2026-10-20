const corner = document.querySelector<HTMLElement>('.corner');

if (corner) {
  // Menú: marca el módulo que está en pantalla.
  const navLinks = [...corner.querySelectorAll<HTMLAnchorElement>('nav a[href^="#"]')];
  const modules = navLinks
    .map((a) => ({ link: a, target: document.querySelector(a.hash) }))
    .filter((m): m is { link: HTMLAnchorElement; target: Element } => m.target !== null);

  const markNav = (): void => {
    const line = innerHeight * 0.35;
    let current: Element | null = null;
    for (const m of modules) if (m.target.getBoundingClientRect().top <= line) current = m.target;
    if (current && current.getBoundingClientRect().bottom < line) current = null;
    for (const m of modules) {
      if (m.target === current) m.link.setAttribute('aria-current', 'true');
      else m.link.removeAttribute('aria-current');
    }
  };

  // Color por capítulo: la barra superior toma el color de la sección que tiene debajo.
  const chapters = [...document.querySelectorAll<HTMLElement>('[data-chapter]')];
  const setInk = (): void => {
    const y = corner.offsetHeight / 2;
    const hit = chapters.find((c) => {
      const r = c.getBoundingClientRect();
      return r.top <= y && r.bottom > y;
    });
    corner.dataset['ink'] = hit?.dataset['chapter'] ?? 'ink';
    let bg = hit ? getComputedStyle(hit).backgroundColor : '';
    if (bg === '' || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') bg = getComputedStyle(document.body).backgroundColor;
    corner.style.backgroundColor = bg;
  };

  // La barra se oculta al bajar y vuelve al subir, para no tapar el contenido.
  let ticking = false;
  let lastY = scrollY;
  const onScroll = (): void => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      markNav();
      setInk();
      const y = scrollY;
      if (Math.abs(y - lastY) > 4) {
        corner.classList.toggle('away', y > lastY && y > innerHeight * 0.6);
        lastY = y;
      }
      ticking = false;
    });
  };

  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);
  markNav();
  setInk();
}
