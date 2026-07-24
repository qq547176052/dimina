import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getMiniAppInfo, getMiniAppManifest } = vi.hoisted(() => ({
	getMiniAppInfo: vi.fn(),
	getMiniAppManifest: vi.fn(),
}))

vi.mock('../src/services', () => ({
	getMiniAppInfo,
	getMiniAppManifest,
}))

vi.mock('../src/pages/miniApp/miniApp', () => ({
	MiniApp: class {
		constructor(opts) {
			this.appId = opts.appId
			this.appInfo = opts
			this.bridgeList = []
		}
	},
}))

const { AppManager } = await import('../src/core/appManager')

describe('AppManager ManifestUrl launch', () => {
	beforeEach(() => {
		AppManager.appStack = []
		getMiniAppInfo.mockReset()
		getMiniAppManifest.mockReset()
		vi.stubGlobal('sessionStorage', {
			getItem: vi.fn(() => null),
			setItem: vi.fn(),
		})
	})

	afterEach(() => {
		vi.unstubAllGlobals()
	})

	it('opens an app using only manifestUrl metadata', async () => {
		getMiniAppManifest.mockResolvedValue({
			appId: 'remote-app',
			name: 'Remote App',
			path: 'pages/index',
			manifestUrl: 'https://cdn.example.com/app.json',
			resourceBaseUrl: 'https://cdn.example.com/apps/',
		})
		const dimina = {
			presentView: vi.fn(),
			destroyRootView: vi.fn(),
		}

		await AppManager.openApp({
			manifestUrl: 'https://cdn.example.com/app.json',
			scene: 1001,
			destroy: true,
		}, dimina)

		expect(getMiniAppInfo).not.toHaveBeenCalled()
		expect(AppManager.appStack).toHaveLength(1)
		expect(AppManager.appStack[0].appInfo).toMatchObject({
			appId: 'remote-app',
			name: 'Remote App',
			pagePath: 'pages/index',
			resourceBaseUrl: 'https://cdn.example.com/apps/',
		})
		expect(dimina.presentView).toHaveBeenCalledWith(AppManager.appStack[0], false)
		expect(sessionStorage.setItem).toHaveBeenCalledWith(
			'dimina:manifest:remote-app',
			'https://cdn.example.com/app.json',
		)
	})
})
