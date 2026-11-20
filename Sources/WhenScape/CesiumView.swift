import SwiftUI
import WebKit
import AppKit

@MainActor
struct CesiumView: NSViewRepresentable {
    @ObservedObject var model: AppModel

    func makeCoordinator() -> Coordinator { Coordinator(model: model) }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        // The app's own on-disk store, so map tiles and other downloads can be
        // reused across launches as far as each provider's cache headers allow,
        // instead of being fetched again (and counted against quotas) every time.
        configuration.websiteDataStore = .default()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.userContentController.add(WeakSceneMessageHandler(target: context.coordinator), name: "scene")
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = false
        webView.setValue(false, forKey: "drawsBackground")
        webView.isInspectable = Self.inspectable(model)
        context.coordinator.webView = webView
        context.coordinator.start()
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        context.coordinator.model = model
        webView.isInspectable = Self.inspectable(model)
        context.coordinator.pushState()
    }

    /// Safari's Web Inspector can attach in debug builds, or with the diagnostics setting on.
    private static func inspectable(_ model: AppModel) -> Bool {
        #if DEBUG
        return true
        #else
        return model.sceneDiagnostics
        #endif
    }

    static func dismantleNSView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.stopLoading()
        webView.navigationDelegate = nil
        webView.uiDelegate = nil
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "scene")
        coordinator.stop()
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        var model: AppModel
        weak var webView: WKWebView?
        private var server: LocalAssetServer?
        private var documentURL: URL?
        private var loaded = false
        private var lastJSON: String?
        private var evaluating = false
        private var pushPending = false
        private var stopped = false
        private var terminationRetries = 0
        private var generation = UUID()
        private var observers: [NSObjectProtocol] = []
        private var lastActivity: [String: Bool]?

        init(model: AppModel) { self.model = model }

        /// Tell the scene whether its window can be seen and whether the app is
        /// in front, so it stops drawing while covered and slows down behind.
        private func observeActivity() {
            let center = NotificationCenter.default
            let names: [Notification.Name] = [NSWindow.didChangeOcclusionStateNotification,
                                              NSApplication.didBecomeActiveNotification, NSApplication.didResignActiveNotification,
                                              NSApplication.didHideNotification, NSApplication.didUnhideNotification]
            observers = names.map { name in
                center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                    MainActor.assumeIsolated { self?.pushActivity() }
                }
            }
        }

        func pushActivity(force: Bool = false) {
            guard loaded, !stopped, let webView else { return }
            // Before the view joins a window there is nothing to judge; assume visible.
            let visible = webView.window.map { $0.occlusionState.contains(.visible) } ?? true
            let activity = ["visible": visible, "active": NSApp.isActive]
            guard force || activity != lastActivity else { return }
            lastActivity = activity
            webView.callAsyncJavaScript("window.whenScape?.setActivity(activity);", arguments: ["activity": activity],
                                        in: nil, in: .page) { _ in }
        }

        func start() {
            guard let root = Bundle.module.url(forResource: "Web", withExtension: nil) else {
                fail("The bundled scene is missing. Rebuild the app’s web assets.")
                return
            }
            observeActivity()
            let server = LocalAssetServer(root: root)
            self.server = server
            server.start { [weak self] result in
                guard let self, !self.stopped else { return }
                switch result {
                case .success(let url):
                    self.documentURL = url
                    self.webView?.load(URLRequest(url: url))
                case .failure(let error): self.fail(error.localizedDescription)
                }
            }
        }

        func stop() {
            stopped = true
            generation = UUID()
            observers.forEach(NotificationCenter.default.removeObserver)
            observers = []
            server?.stop()
            server = nil
            webView = nil
        }

        func pushState(force: Bool = false) {
            guard loaded, !stopped, let webView else { return }
            if evaluating { pushPending = true; return }
            guard let data = try? JSONSerialization.data(withJSONObject: model.sceneState, options: [.sortedKeys]),
                  let json = String(data: data, encoding: .utf8), force || json != lastJSON else { return }
            evaluating = true
            let requestGeneration = generation
            // JSON is an argument, never interpolated as executable source. In
            // particular, coordinates and the ion token never enter HTTP URLs.
            webView.callAsyncJavaScript("if (!window.whenScape) return false; window.whenScape.update(state); return true;",
                                        arguments: ["state": model.sceneState], in: nil, in: .page) { [weak self] result in
                guard let self, !self.stopped, self.generation == requestGeneration else { return }
                self.evaluating = false
                switch result {
                case .success(let sent):
                    if (sent as? Bool) == true { self.lastJSON = json }
                case .failure:
                    self.loaded = false
                    self.model.sceneReady = false
                    self.model.sceneMessage = "The scene is not responding. Reopen the window to reload it."
                }
                if self.pushPending { self.pushPending = false; self.pushState() }
            }
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard !stopped, message.name == "scene", message.frameInfo.isMainFrame,
                  isSceneURL(message.frameInfo.request.url), let status = message.body as? [String: Any] else { return }
            model.receiveSceneStatus(status)
            if (status["ready"] as? Bool) == true || (status["type"] as? String) == "ready" {
                let first = !loaded
                loaded = true
                pushState()
                if first { pushActivity(force: true) }
            }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            guard isSceneURL(webView.url) else { return }
            loaded = true
            lastJSON = nil
            pushState(force: true)
            pushActivity(force: true)
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            generation = UUID()
            loaded = false
            lastJSON = nil
            evaluating = false
            pushPending = false
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { failLoading(error) }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { failLoading(error) }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            generation = UUID()
            loaded = false
            lastJSON = nil
            evaluating = false
            pushPending = false
            model.sceneReady = false
            guard terminationRetries < 1 else {
                fail("The 3D renderer stopped. Try lower scene detail and reopen the window.")
                return
            }
            terminationRetries += 1
            model.sceneMessage = "Restarting the 3D renderer…"
            webView.reload()
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            if isSceneURL(navigationAction.request.url), navigationAction.targetFrame?.isMainFrame != false {
                decisionHandler(.allow)
            } else {
                if navigationAction.navigationType == .linkActivated { openExternal(navigationAction.request.url) }
                decisionHandler(.cancel)
            }
        }

        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if navigationAction.navigationType == .linkActivated { openExternal(navigationAction.request.url) }
            return nil
        }

        private func isSceneURL(_ url: URL?) -> Bool {
            guard let url, let documentURL else { return false }
            return url.scheme == "http" && url.host == "127.0.0.1" && url.port == documentURL.port && url.path == "/index.html"
        }

        private func openExternal(_ url: URL?) {
            guard let url, url.scheme == "https" else { return }
            NSWorkspace.shared.open(url)
        }

        private func failLoading(_ error: Error) {
            if (error as NSError).code == NSURLErrorCancelled { return }
            fail("The 3D scene could not load. Reopen the window to try again.")
        }

        private func fail(_ message: String) {
            loaded = false
            model.sceneReady = false
            model.sceneMessage = message
        }
    }
}

/// WKUserContentController retains its handler, so keep the coordinator weak.
private final class WeakSceneMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}
