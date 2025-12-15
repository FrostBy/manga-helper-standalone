/**
 * DOM helpers for MangaLib manga page
 */

/**
 * Create dropdown button by cloning existing button group
 */
export function createDropdownButton(): HTMLElement {
  const group = document.querySelector('.fade.container .btns._group');
  if (!group) {
    // Fallback: create simple button
    const btn = document.createElement('button');
    btn.className = 'btn platforms';
    btn.textContent = 'Открыть на сайте';
    return btn;
  }

  const clone = group.cloneNode(true) as HTMLElement;
  const span = clone.querySelector('span');
  if (span) span.textContent = 'Открыть на сайте';

  // Remove icons and loader we don't need
  clone.querySelector('.fa-bookmark')?.remove();
  clone.querySelector('.fa-plus')?.remove();
  clone.querySelector('.loader-wrapper')?.remove();
  clone.querySelector('.btn__loader')?.remove();

  // Remove loading state
  clone.classList.remove('is-loading');
  clone.querySelectorAll('[disabled]').forEach(el => el.removeAttribute('disabled'));

  clone.classList.add('platforms');
  return clone;
}
