#!/usr/bin/env node

import path from 'node:path'
import process from 'node:process'
import chokidar from 'chokidar'
import { program } from 'commander'
import pack from '../../package.json' with { type: 'json' }
import build from '../index.js'

program
	.command('build')
	.option('-c, --work-path <path>', '编译工作目录')
	.option('-s, --target-path <path>', '编译产物存放路径')
	.option('-w, --watch', '启用监听文件改动')
	.option('--no-app-id-dir', '产物根目录不包含appId')
	.option('--sourcemap', '生成 sourcemap 文件用于调试')
	.action(async (options) => {
		const workPath = options.workPath ? path.resolve(options.workPath) : process.cwd()
		const targetPath = options.targetPath ? path.resolve(options.targetPath) : process.cwd()
		const useAppIdDir = options.appIdDir !== false
		const sourcemap = !!options.sourcemap

		try {
			await build(targetPath, workPath, useAppIdDir, { sourcemap })
		}
		catch (error) {
			throw new Error(`${workPath} 编译出错: ${error.message}`, { cause: error })
		}
		const watch = options.watch
		if (watch) {
			chokidar
				.watch(workPath, {
					persistent: true, // 持续监听
					ignoreInitial: true, // 忽略初始的 add/addDir 事件
				})
				.on('all', async (event, path) => {
					if (event === 'change') {
						console.log(`${path} 改动，重新编译`)
						try {
							await build(targetPath, workPath, useAppIdDir, { sourcemap })
						}
						catch (error) {
							console.error(`${workPath} 编译出错: ${error.message}`)
						}
					}
				})
		}
	})

program
	.name('dmcc')
	.version(pack.version)

program.parseAsync(process.argv).catch((error) => {
	console.error(error.stack || error.message)
	process.exitCode = 1
})
