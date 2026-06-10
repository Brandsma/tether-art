const SEEN_KEY = 'p2p-pixels:intro-seen'

export function initInfoModal(cooldownMs: number): void {
  const backdrop = document.getElementById('info-modal')!
  const closeBtn = document.getElementById('info-close')!
  const infoBtn = document.getElementById('info-btn')!
  const cooldownSpan = document.getElementById('modal-cooldown')!

  const mins = cooldownMs / 60_000
  cooldownSpan.textContent = mins === 1 ? 'one minute' : `${mins} minutes`

  const open = (): void => {
    backdrop.hidden = false
    closeBtn.focus()
  }

  const close = (): void => {
    backdrop.hidden = true
    localStorage.setItem(SEEN_KEY, '1')
  }

  closeBtn.addEventListener('click', close)
  infoBtn.addEventListener('click', open)

  backdrop.addEventListener('click', e => {
    if (e.target === backdrop) close()
  })

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !backdrop.hidden) close()
  })

  if (!localStorage.getItem(SEEN_KEY)) open()
}
