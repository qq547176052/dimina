import { describe, expect, it, vi } from 'vitest'
import { Bridge } from '../src/core/bridge'

describe('Bridge resource loading protocol', () => {
	it('flushes the queued pageShow after resourceLoaded in service message order', () => {
		const jscore = { postMessage: vi.fn() }
		const bridge = new Bridge({
			jscore,
			pagePath: 'pages/index/index',
			scene: 1001,
			query: {},
		})
		bridge.id = 'bridge-visible'

		bridge.pageShow()
		expect(jscore.postMessage).not.toHaveBeenCalled()

		bridge.messageInvoke('service', {
			type: 'serviceResourceLoaded',
			target: 'service',
			body: { bridgeId: bridge.id },
		})
		bridge.messageInvoke('render', {
			type: 'renderResourceLoaded',
			target: 'service',
			body: { bridgeId: bridge.id },
		})

		expect(jscore.postMessage.mock.calls.map(([message]) => message.type)).toEqual([
			'resourceLoaded',
			'pageShow',
		])
	})

	it('keeps only the latest queued visibility and suppresses duplicate notifications', () => {
		const jscore = { postMessage: vi.fn() }
		const bridge = new Bridge({
			jscore,
			pagePath: 'pages/index/index',
			scene: 1001,
			query: {},
		})
		bridge.id = 'bridge-hidden'

		bridge.pageShow()
		bridge.pageHide()
		bridge.messageInvoke('service', {
			type: 'serviceResourceLoaded',
			target: 'service',
			body: { bridgeId: bridge.id },
		})
		bridge.messageInvoke('render', {
			type: 'renderResourceLoaded',
			target: 'service',
			body: { bridgeId: bridge.id },
		})
		bridge.pageHide()

		expect(jscore.postMessage.mock.calls.map(([message]) => message.type)).toEqual([
			'resourceLoaded',
			'pageHide',
		])
	})

	it('does not overwrite an early pageHide when start uses its default visibility', () => {
		const jscore = { postMessage: vi.fn() }
		const bridge = new Bridge({
			jscore,
			appId: 'app-1',
			pagePath: 'pages/index/index',
			root: '.',
			scene: 1001,
			query: {},
		})
		bridge.id = 'bridge-early-hidden'
		bridge.webview = { postMessage: vi.fn() }
		bridge.parent = { getHostEnvSnapshot: vi.fn(() => ({})) }

		bridge.pageHide()
		bridge.start()
		expect(jscore.postMessage.mock.calls[0][0]).toMatchObject({
			type: 'loadResource',
			body: {
				scene: 1001,
				query: {},
			},
		})
		bridge.messageInvoke('service', {
			type: 'serviceResourceLoaded',
			target: 'service',
			body: { bridgeId: bridge.id },
		})
		bridge.messageInvoke('render', {
			type: 'renderResourceLoaded',
			target: 'service',
			body: { bridgeId: bridge.id },
		})

		expect(jscore.postMessage.mock.calls.map(([message]) => message.type)).toEqual([
			'loadResource',
			'resourceLoaded',
			'pageHide',
		])
	})

	it('uses the manifest resource base for both render and service loaders', () => {
		const jscore = { postMessage: vi.fn() }
		const bridge = new Bridge({
			jscore,
			appId: 'remote-app',
			pagePath: 'pages/index/index',
			root: 'main',
			scene: 1001,
			query: {},
			baseUrl: 'https://cdn.example.com/apps/',
		})
		bridge.webview = { postMessage: vi.fn() }
		bridge.parent = { getHostEnvSnapshot: vi.fn(() => ({})) }

		bridge.start()

		expect(bridge.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
			type: 'loadResource',
			body: expect.objectContaining({
				baseUrl: 'https://cdn.example.com/apps/',
			}),
		}))
		expect(jscore.postMessage).toHaveBeenCalledWith(expect.objectContaining({
			type: 'loadResource',
			body: expect.objectContaining({
				baseUrl: 'https://cdn.example.com/apps/',
			}),
		}))
	})

	it('forwards render failures without marking resources as loaded', () => {
		const jscore = { postMessage: vi.fn() }
		const bridge = new Bridge({
			jscore,
			pagePath: 'pages/index/index',
			scene: 1001,
			query: {},
		})
		bridge.id = 'bridge-failure'
		bridge.serviceResource = true
		bridge.renderResource = true

		bridge.messageInvoke('render', {
			type: 'renderResourceLoadFailed',
			target: 'service',
			body: {
				bridgeId: bridge.id,
				errors: ['script failed'],
			},
		})

		expect(bridge.renderResource).toBe(false)
		expect(bridge.isResourceLoaded()).toBe(false)
		expect(jscore.postMessage).toHaveBeenCalledWith({
			type: 'resourceLoadFailed',
			body: {
				bridgeId: bridge.id,
				pagePath: 'pages/index/index',
				scene: 1001,
				query: {},
				errors: ['script failed'],
			},
		})
	})

	it('forwards resourceLoaded only once when a side repeats its acknowledgement', () => {
		const jscore = { postMessage: vi.fn() }
		const bridge = new Bridge({
			jscore,
			pagePath: 'pages/index/index',
			scene: 1001,
			query: {},
		})
		bridge.id = 'bridge-duplicate-resource'

		for (const type of ['serviceResourceLoaded', 'renderResourceLoaded', 'renderResourceLoaded']) {
			bridge.messageInvoke('render', {
				type,
				target: 'service',
				body: { bridgeId: bridge.id },
			})
		}

		expect(jscore.postMessage.mock.calls.map(([message]) => message.type)).toEqual(['resourceLoaded'])
	})

	it('drops late resource acknowledgements after an in-flight bridge is destroyed', () => {
		const jscore = { postMessage: vi.fn() }
		const bridge = new Bridge({
			jscore,
			pagePath: 'pages/index/index',
			scene: 1001,
			query: {},
		})
		bridge.id = 'bridge-destroyed-during-load'
		bridge.pageShow()
		bridge.destroy()

		bridge.messageInvoke('service', {
			type: 'serviceResourceLoaded',
			target: 'service',
			body: { bridgeId: bridge.id },
		})
		bridge.messageInvoke('render', {
			type: 'renderResourceLoaded',
			target: 'service',
			body: { bridgeId: bridge.id },
		})

		expect(jscore.postMessage).not.toHaveBeenCalled()
	})

	it('ignores resource acknowledgements from an earlier start on a reused bridge', () => {
		const jscore = { postMessage: vi.fn() }
		const bridge = new Bridge({
			jscore,
			appId: 'app-1',
			pagePath: 'pages/index/index',
			root: '.',
			scene: 1001,
			query: {},
		})
		bridge.id = 'bridge-reused-load'
		bridge.webview = { postMessage: vi.fn() }
		bridge.parent = { getHostEnvSnapshot: vi.fn(() => ({})) }

		bridge.start()
		const staleResourceLoadId = bridge.resourceLoadId
		bridge.resetStatus()
		bridge.start()
		const currentResourceLoadId = bridge.resourceLoadId
		jscore.postMessage.mockClear()

		for (const type of ['serviceResourceLoaded', 'renderResourceLoaded']) {
			bridge.messageInvoke('render', {
				type,
				target: 'service',
				body: { bridgeId: bridge.id, resourceLoadId: staleResourceLoadId },
			})
		}
		expect(jscore.postMessage).not.toHaveBeenCalled()

		for (const type of ['serviceResourceLoaded', 'renderResourceLoaded']) {
			bridge.messageInvoke('render', {
				type,
				target: 'service',
				body: { bridgeId: bridge.id, resourceLoadId: currentResourceLoadId },
			})
		}

		expect(jscore.postMessage.mock.calls.map(([message]) => message.type)).toEqual([
			'resourceLoaded',
			'pageShow',
		])
	})
})
