import { describe, expect, it, vi } from 'vitest'
import { WebView } from '../src/pages/webview/webview'

describe('WebView remote resource base', () => {
	it('points relative compiled assets at the manifest resource directory', () => {
		const webview = Object.create(WebView.prototype)
		webview.opts = { resourceBaseUrl: 'https://cdn.example.com/apps/' }
		const prepend = vi.fn()
		const frameDocument = {
			createElement: vi.fn(() => ({ href: '' })),
			head: { prepend },
		}

		webview.applyResourceBaseUrl(frameDocument)

		expect(frameDocument.createElement).toHaveBeenCalledWith('base')
		expect(prepend).toHaveBeenCalledWith({
			href: 'https://cdn.example.com/apps/',
		})
	})

	it('does not alter local page frames', () => {
		const webview = Object.create(WebView.prototype)
		webview.opts = {}
		const frameDocument = {
			createElement: vi.fn(),
			head: { prepend: vi.fn() },
		}

		webview.applyResourceBaseUrl(frameDocument)

		expect(frameDocument.createElement).not.toHaveBeenCalled()
		expect(frameDocument.head.prepend).not.toHaveBeenCalled()
	})
})
