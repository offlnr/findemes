// Entradas por sección, una vez.
const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add('in');
        io.unobserve(e.target);
      }
    }
  },
  { rootMargin: '0px 0px -10% 0px' },
);
document.querySelectorAll('.rise').forEach((el) => { io.observe(el); });

// Preguntas: al hacer clic, la respuesta se despliega con animación. Sin script, todas quedan visibles.
document.querySelectorAll<HTMLElement>('.qa .q').forEach((q) => {
  const btn = q.querySelector('button');
  btn?.addEventListener('click', () => {
    const open = btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', String(open));
    q.classList.toggle('open', open);
  });
});
