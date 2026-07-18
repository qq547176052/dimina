import { modDefine } from '@dimina/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import loader from '../src/core/loader'
import runtime from '../src/core/runtime'
import '../src/index'

describe('getApp', () => {
	beforeEach(() => {
		runtime.app = undefined
		runtime.defaultApp = {}
		runtime.appLaunchOptions = {}
		runtime.instances = {}
		runtime.pageStates.clear()
		delete loader.staticModules.app
		globalThis.DiminaServiceBridge.invoke = vi.fn()
		globalThis.DiminaServiceBridge.publish = vi.fn()
	})

	it('keeps and merges the allowDefault app before App is declared', () => {
		expect(globalThis.getApp()).toBeUndefined()

		const defaultApp = globalThis.getApp({ allowDefault: true })
		expect(globalThis.getApp({ allowDefault: true })).toBe(defaultApp)

		defaultApp.defaultOnly = 'from-default-app'
		defaultApp.conflict = 'default-app-wins'
		defaultApp.defaultMethod = function () {
			return this
		}

		const query = { source: 'test' }
		let launchOptions
		runtime.setAppLaunchOptions({
			scene: 1001,
			pagePath: 'pages/index/index',
			query,
		})
		globalThis.App({
			globalData: { ready: true },
			appOnly: 'from-app',
			conflict: 'app-value',
			onLaunch(options) {
				launchOptions = options
			},
		})

		const app = globalThis.getApp()
		expect(app).not.toBe(defaultApp)
		expect(globalThis.getApp({ allowDefault: true })).toBe(app)
		expect(app.defaultOnly).toBe('from-default-app')
		expect(app.appOnly).toBe('from-app')
		expect(app.conflict).toBe('default-app-wins')
		expect(app.defaultMethod()).toBe(app)
		expect(launchOptions).toEqual({
			scene: 1001,
			path: 'pages/index/index',
			query,
		})
	})

	it('creates the App before evaluating the first page module', () => {
		const pagePath = 'pages/get-app-startup/index'
		const query = { id: 'startup' }
		let appSeenByPage
		let launchOptions

		modDefine('app', () => {
			globalThis.App({
				globalData: { ready: true },
				onLaunch(options) {
					launchOptions = options
				},
			})
		})
		modDefine(pagePath, () => {
			appSeenByPage = globalThis.getApp()
			globalThis.__extraInfo = {
				path: pagePath,
				usingComponents: {},
			}
			globalThis.Page({})
		})

		globalThis.DiminaServiceBridge.onMessage({
			type: 'loadResource',
			body: {
				appId: 'get-app-test',
				bridgeId: 'bridge-get-app',
				pagePath,
				query,
				resourceLoadId: 'resource-get-app',
				root: '.',
				scene: 1001,
			},
		})

		expect(appSeenByPage).toBe(globalThis.getApp())
		expect(appSeenByPage.globalData).toEqual({ ready: true })
		expect(launchOptions).toEqual({
			scene: 1001,
			path: pagePath,
			query,
		})
		expect(globalThis.DiminaServiceBridge.invoke).toHaveBeenCalledWith(expect.objectContaining({
			type: 'serviceResourceLoaded',
			body: expect.objectContaining({
				resourceLoadId: 'resource-get-app',
			}),
		}))

		delete loader.staticModules[pagePath]
	})
})
