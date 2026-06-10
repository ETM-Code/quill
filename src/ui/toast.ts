// Bottom-center toasts for errors, confirmations, and recovery actions.

let container: HTMLDivElement | null = null

function ensureContainer(): HTMLDivElement {
  if (!container) {
    container = document.createElement('div')
    container.id = 'toast-container'
    document.body.appendChild(container)
  }
  return container
}

export interface ToastAction {
  label: string
  onClick: () => void
}

export function showToast(
  message: string,
  opts: { kind?: 'info' | 'error' | 'success'; duration?: number; action?: ToastAction } = {},
): void {
  const { kind = 'info', duration = kind === 'error' ? 6000 : 2500, action } = opts
  const el = document.createElement('div')
  el.className = `toast toast-${kind}`
  const text = document.createElement('span')
  text.textContent = message
  el.appendChild(text)

  let dismissed = false
  const dismiss = () => {
    if (dismissed) return
    dismissed = true
    el.classList.add('toast-out')
    setTimeout(() => el.remove(), 200)
  }

  if (action) {
    const btn = document.createElement('button')
    btn.className = 'toast-action'
    btn.textContent = action.label
    btn.addEventListener('click', () => {
      action.onClick()
      dismiss()
    })
    el.appendChild(btn)
  }

  ensureContainer().appendChild(el)
  requestAnimationFrame(() => el.classList.add('toast-in'))
  setTimeout(dismiss, duration)
}
