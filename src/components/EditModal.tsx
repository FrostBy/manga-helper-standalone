import { useEffect, useRef, useState } from 'preact/hooks';
import { useMangaStore } from '@/src/stores/manga';
import { useMappingsStore } from '@/src/stores/mappings';
import { getAPI } from '@/src/api';
import { t } from '@/src/utils';
import type { PlatformKey } from '@/src/types';

interface Props {
  onSave: (platformKey: PlatformKey, url: string) => void;
  onDelete: (platformKey: PlatformKey) => void;
}

export function EditModal({ onSave, onDelete }: Props) {
  const isOpen = useMangaStore((s) => s.isModalOpen);
  const modalPlatform = useMangaStore((s) => s.modalPlatform);
  const modalUrl = useMangaStore((s) => s.modalUrl);
  const closeModal = useMangaStore((s) => s.closeModal);

  const manualLinks = useMappingsStore((s) => s.manualLinks);
  const autoLinks = useMappingsStore((s) => s.autoLinks);
  const offsets = useMappingsStore((s) => s.offsets);
  const disabledMap = useMappingsStore((s) => s.disabled);
  const setOffset = useMappingsStore((s) => s.setOffset);
  const setDisabledAction = useMappingsStore((s) => s.setDisabled);

  const inputRef = useRef<HTMLInputElement>(null);
  const [hasError, setHasError] = useState(false);
  const [isDisabled, setIsDisabled] = useState(false);
  const [offsetValue, setOffsetValue] = useState(0);

  const manualValue = modalPlatform ? manualLinks[modalPlatform] : undefined;
  const autoValue = modalPlatform ? autoLinks[modalPlatform] : undefined;
  const savedSlug = manualValue ?? autoValue;
  const hasSavedSlug = typeof savedSlug === 'string';
  const isPlatformDisabled = modalPlatform ? disabledMap[modalPlatform] === true : false;
  const currentOffset = modalPlatform ? offsets[modalPlatform] ?? 0 : 0;
  const hasAnySaved = hasSavedSlug || isPlatformDisabled || currentOffset !== 0;

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.value = modalUrl;
      setHasError(false);
      setIsDisabled(isPlatformDisabled);
      setOffsetValue(currentOffset);
      if (!isPlatformDisabled) inputRef.current.focus();
    }
  }, [isOpen, modalUrl, isPlatformDisabled, currentOffset]);

  useEffect(() => {
    if (isOpen) document.body.classList.add('modal-open');
    else document.body.classList.remove('modal-open');
    return () => document.body.classList.remove('modal-open');
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModal();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, closeModal]);

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    if (!modalPlatform) return;

    // F5.6: only persist if values actually changed
    if (offsetValue !== currentOffset) {
      await setOffset(modalPlatform, offsetValue);
    }
    if (isDisabled !== isPlatformDisabled) {
      await setDisabledAction(modalPlatform, isDisabled);
    }

    if (isDisabled) {
      setHasError(false);
      closeModal();
      return;
    }

    const url = inputRef.current?.value.trim() ?? '';

    if (url === '') {
      setHasError(false);
      onDelete(modalPlatform);
      closeModal();
      return;
    }

    // URL не менялся — не трогаем slot (иначе auto промоутнется в manual без намерения).
    if (url === modalUrl.trim()) {
      setHasError(false);
      closeModal();
      return;
    }

    const api = getAPI(modalPlatform);
    const slug = api.getSlugFromURL(url);

    if (!slug) {
      setHasError(true);
      return;
    }

    setHasError(false);
    onSave(modalPlatform, url);
    closeModal();
  };

  const handleCleanClick = () => {
    if (!modalPlatform) return;
    if (hasAnySaved) onDelete(modalPlatform);
    closeModal();
  };

  const handleClose = () => {
    closeModal();
  };

  if (!isOpen) return null;

  return (
    <div class="modal is-open" id="edit-link-modal">
      <div class="modal__inner">
        <div class="modal__content" data-size="small">
          <div class="modal__header">
            <div class="modal__title">{t('editLink')}</div>
            <div class="modal__close" onClick={handleClose}>
              <CloseIcon />
            </div>
          </div>
          <div class="modal__body">
            <form id="edit-link-form" onSubmit={handleSubmit}>
              <div class="form__field">
                <div class="form__label">
                  <span>{t('fullLinkToTitle')}</span>
                </div>
                <input
                  ref={inputRef}
                  type="text"
                  name="link"
                  class={`form__input${hasError ? ' form__input--error' : ''}`}
                  placeholder="https://example.com/manga/slug"
                  disabled={isDisabled}
                  style={{ marginBottom: '8px' }}
                  onInput={() => hasError && setHasError(false)}
                />
              </div>
              <div
                class="form__field form__field--row"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}
              >
                <label class="form__checkbox" style={{ display: 'inline-flex', alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={isDisabled}
                    style={{ marginRight: '5px' }}
                    onChange={(e) => setIsDisabled((e.currentTarget as HTMLInputElement).checked)}
                  />
                  <span>{t('disablePlatform')}</span>
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <span>{t('offsetLabel')}</span>
                  <input
                    type="number"
                    min={-1000}
                    max={1000}
                    step={1}
                    value={offsetValue}
                    class="form__input"
                    style={{ width: '70px' }}
                    onInput={(e) => {
                      const raw = (e.currentTarget as HTMLInputElement).value;
                      const parsed = parseInt(raw, 10);
                      setOffsetValue(Number.isFinite(parsed) ? parsed : 0);
                    }}
                  />
                </label>
              </div>
              <div class="form__footer">
                <button class="btn button_save" type="submit">
                  <SaveIcon />
                  {t('save')}
                </button>
                <button class="btn button_clean" type="button" onClick={handleCleanClick}>
                  <DeleteIcon />
                  <span class="button_clean-text">
                    {hasAnySaved ? t('delete') : t('cancel')}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg class="modal__close-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512">
      <path d="M342.6 150.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L192 210.7 86.6 105.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L146.7 256 41.4 361.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L192 301.3 297.4 406.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L237.3 256 342.6 150.6z" />
    </svg>
  );
}

function SaveIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512">
      <path d="M433.941 129.941l-83.882-83.882A48 48 0 0 0 316.118 32H48C21.49 32 0 53.49 0 80v352c0 26.51 21.49 48 48 48h352c26.51 0 48-21.49 48-48V163.882a48 48 0 0 0-14.059-33.941zM224 416c-35.346 0-64-28.654-64-64 0-35.346 28.654-64 64-64s64 28.654 64 64c0 35.346-28.654 64-64 64zm96-304.52V212c0 6.627-5.373 12-12 12H76c-6.627 0-12-5.373-12-12V108c0-6.627 5.373-12 12-12h228.52c3.183 0 6.235 1.264 8.485 3.515l3.48 3.48A11.996 11.996 0 0 1 320 111.48z" />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640">
      <path d="M232.7 69.9L224 96L128 96C110.3 96 96 110.3 96 128C96 145.7 110.3 160 128 160L512 160C529.7 160 544 145.7 544 128C544 110.3 529.7 96 512 96L416 96L407.3 69.9C402.9 56.8 390.7 48 376.9 48L263.1 48C249.3 48 237.1 56.8 232.7 69.9zM512 208L128 208L149.1 531.1C150.7 556.4 171.7 576 197 576L443 576C468.3 576 489.3 556.4 490.9 531.1L512 208z" />
    </svg>
  );
}
