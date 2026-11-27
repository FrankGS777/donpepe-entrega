(() => {
  for (const form of document.querySelectorAll('[data-commerce-flow]')) {
    const panels = [...form.querySelectorAll('[data-flow-panel]')];
    if (!panels.length) continue;
    const labels = panels.map(panel => panel.dataset.flowLabel);
    const progress = document.createElement('ol');
    progress.className = 'commerce-steps';
    progress.setAttribute('aria-label', 'Progreso del pedido');
    const footer = document.createElement('div');
    footer.className = 'commerce-navigation';
    const back = document.createElement('button');
    back.type = 'button'; back.className = 'ops-button subtle'; back.textContent = '← Atrás';
    const next = document.createElement('button');
    next.type = 'button'; next.className = 'ops-button primary'; next.textContent = 'Continuar →';
    const hint = document.createElement('p');
    hint.className = 'commerce-hint'; hint.setAttribute('role', 'status');
    footer.append(back, hint, next);
    form.prepend(progress); form.append(footer);
    let step = 0;
    const buttons = labels.map((label, index) => {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      const number = document.createElement('span'); number.textContent = index + 1;
      const title = document.createElement('strong'); title.textContent = label;
      button.append(number, title); li.append(button); progress.append(li);
      button.addEventListener('click', () => { if(index < step) show(index); });
      return button;
    });
    function validPanel() {
      const panel = panels[step];
      for (const control of panel.querySelectorAll('[required]')) {
        if (!control.checkValidity()) {
          hint.textContent = control.validationMessage || 'Completa este paso.';
          // Complex selects keep a native select hidden behind an accessible button.
          if(control.offsetParent) control.reportValidity();
          else panel.querySelector('button,input:not([type=hidden]),select')?.focus();
          return false;
        }
      }
      if (panel.dataset.flowItems) {
        let items;
        try { items = JSON.parse(form.querySelector(panel.dataset.flowItems)?.value || '[]'); }
        catch { items = []; }
        if (!Array.isArray(items) || !items.length) {
          hint.textContent = 'Agrega al menos un producto para continuar.';
          return false;
        }
      }
      return true;
    }
    function show(index, focus = true) {
      step = index;
      panels.forEach((panel, position) => { panel.hidden = position !== index; });
      buttons.forEach((button, position) => {
        button.classList.toggle('current', position === index);
        button.classList.toggle('complete', position < index);
        button.disabled = position > index;
        if(position===index) button.setAttribute('aria-current','step');
        else button.removeAttribute('aria-current');
      });
      back.hidden = index === 0;
      next.hidden = index === panels.length - 1;
      form.querySelectorAll('[data-flow-submit]').forEach(button => { button.hidden = index !== panels.length - 1; });
      hint.textContent = `Paso ${index + 1} de ${panels.length}`;
      if(focus) {
        const heading = panels[index].querySelector('h2');
        if(heading) { heading.tabIndex = -1; heading.focus({preventScroll:true}); }
        progress.scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth'});
      }
    }
    back.addEventListener('click',()=>show(Math.max(0,step-1)));
    next.addEventListener('click',()=>{ if(validPanel()) show(Math.min(panels.length-1,step+1)); });
    form.addEventListener('invalid', event => {
      const index = panels.findIndex(panel=>panel.contains(event.target));
      if(index>=0 && index!==step) show(index);
    }, true);
    form.addEventListener('submit',event=>{
      if(step!==panels.length-1 || !validPanel()) event.preventDefault();
    });
    show(0,false);
  }
})();
