//
//  DMPNavigatorCapsuleTests.swift
//  diminaTests
//

import UIKit
import XCTest
@testable import dimina

@MainActor
final class DMPNavigatorCapsuleTests: XCTestCase {

    func testSetupInstallsOneContainerOwnedCapsule() {
        let navigationController = UINavigationController()
        navigationController.loadViewIfNeeded()
        let navigator = DMPNavigator()

        navigator.setup(navigationController: navigationController)
        navigator.setCapsuleVisible(true)

        XCTAssertEqual(capsules(in: navigationController.view).count, 1)
        XCTAssertFalse(capsules(in: navigationController.view)[0].isHidden)
    }

    func testRepeatedSetupReplacesRatherThanDuplicatesCapsule() {
        let navigationController = UINavigationController()
        navigationController.loadViewIfNeeded()
        let navigator = DMPNavigator()

        navigator.setup(navigationController: navigationController)
        navigator.setup(navigationController: navigationController)

        XCTAssertEqual(capsules(in: navigationController.view).count, 1)
    }

    func testContainerReloadResetClearsTransientLoadingAndNavigationState() {
        let container = DMPContainer()
        container.isNavigating = true
        container.hasLoadResource(webViewId: 7, type: .serviceLoaded)
        container.hasLoadResource(webViewId: 7, type: .renderLoaded)

        XCTAssertTrue(container.isResourceLoaded(webViewId: 7))

        container.resetForReload()

        XCTAssertFalse(container.isNavigating)
        XCTAssertFalse(container.isResourceLoaded(webViewId: 7))
    }

    func testStalePageCannotClearLoadingObserverOfReusedWebView() {
        let webview = DMPWebview(delegate: nil, appName: "test", appId: "test")
        let oldPageToken = UUID()
        let newPageToken = UUID()
        var loadingStates: [Bool] = []

        webview.setLoadingStateObserver(ownerToken: oldPageToken) { _ in
            XCTFail("The old page observer must be replaced")
        }
        webview.setLoadingStateObserver(ownerToken: newPageToken) { isLoading in
            loadingStates.append(isLoading)
        }

        webview.clearLoadingStateObserver(ownerToken: oldPageToken)
        webview.poolState = .loading
        webview.poolState = .ready

        XCTAssertEqual(loadingStates, [true, false])

        webview.clearLoadingStateObserver(ownerToken: newPageToken)
        webview.poolState = .loading

        XCTAssertEqual(loadingStates, [true, false])
    }

    private func capsules(in view: UIView) -> [UIView] {
        let current = view.accessibilityIdentifier == "dimina.navigation.capsule" ? [view] : []
        return current + view.subviews.flatMap(capsules(in:))
    }
}
