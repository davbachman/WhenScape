import Foundation
import Network

/// A loopback-only origin for bundled browser assets. It exposes no application
/// state or write endpoints; scene state is delivered through WKWebView directly.
final class LocalAssetServer {
    enum ServerError: LocalizedError {
        case missingAssets
        case invalidPort
        var errorDescription: String? {
            switch self {
            case .missingAssets: return "The bundled 3D scene is missing. Run the web build before packaging WhenScape."
            case .invalidPort: return "The local scene server could not acquire a port."
            }
        }
    }

    private final class Request {
        let connection: NWConnection
        var bytes = Data()
        var timeout: DispatchWorkItem?
        init(_ connection: NWConnection) { self.connection = connection }
    }

    private let root: URL
    private let queue = DispatchQueue(label: "com.whenscape.assets", qos: .userInitiated)
    private var listener: NWListener?
    private var requests: [UUID: Request] = [:]
    private var port: UInt16?
    private var didCompleteStart = false
    private var stopped = false

    init(root: URL) {
        self.root = root.standardizedFileURL.resolvingSymlinksInPath()
    }

    func start(completion: @escaping (Result<URL, Error>) -> Void) {
        queue.async { [weak self] in
            guard let self, !self.stopped else { return }
            guard FileManager.default.fileExists(atPath: self.root.appendingPathComponent("index.html").path) else {
                self.finishStart(.failure(ServerError.missingAssets), completion: completion)
                return
            }
            do {
                let parameters = NWParameters.tcp
                parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
                parameters.allowLocalEndpointReuse = true
                let listener = try NWListener(using: parameters)
                self.listener = listener
                listener.newConnectionHandler = { [weak self] connection in self?.accept(connection) }
                listener.stateUpdateHandler = { [weak self, weak listener] state in
                    guard let self, !self.stopped else { return }
                    switch state {
                    case .ready:
                        guard let port = listener?.port?.rawValue,
                              let url = URL(string: "http://127.0.0.1:\(port)/index.html") else {
                            self.finishStart(.failure(ServerError.invalidPort), completion: completion)
                            return
                        }
                        self.port = port
                        self.finishStart(.success(url), completion: completion)
                    case .failed(let error):
                        self.finishStart(.failure(error), completion: completion)
                    default: break
                    }
                }
                listener.start(queue: self.queue)
            } catch { self.finishStart(.failure(error), completion: completion) }
        }
    }

    private func finishStart(_ result: Result<URL, Error>, completion: @escaping (Result<URL, Error>) -> Void) {
        guard !didCompleteStart else { return }
        didCompleteStart = true
        DispatchQueue.main.async { completion(result) }
    }

    func stop() {
        queue.async { [self] in
            self.stopped = true
            self.listener?.stateUpdateHandler = nil
            self.listener?.newConnectionHandler = nil
            self.listener?.cancel()
            self.listener = nil
            for request in self.requests.values {
                request.timeout?.cancel()
                request.connection.cancel()
            }
            self.requests.removeAll()
        }
    }

    deinit { listener?.cancel() }

    private func accept(_ connection: NWConnection) {
        guard !stopped, requests.count < 64 else { connection.cancel(); return }
        let id = UUID()
        let request = Request(connection)
        requests[id] = request
        let timeout = DispatchWorkItem { [weak self] in self?.finish(id) }
        request.timeout = timeout
        queue.asyncAfter(deadline: .now() + 15, execute: timeout)
        connection.stateUpdateHandler = { [weak self] state in
            switch state {
            case .failed, .cancelled: self?.finish(id)
            default: break
            }
        }
        connection.start(queue: queue)
        receive(id)
    }

    private func receive(_ id: UUID) {
        guard let request = requests[id] else { return }
        request.connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { [weak self] data, _, complete, error in
            guard let self, let request = self.requests[id] else { return }
            if let data { request.bytes.append(data) }
            guard request.bytes.count <= 16384 else {
                self.respond(id, code: 431, reason: "Request Header Fields Too Large")
                return
            }
            if request.bytes.range(of: Data("\r\n\r\n".utf8)) != nil {
                self.serve(id)
            } else if complete || error != nil {
                self.finish(id)
            } else { self.receive(id) }
        }
    }

    private func serve(_ id: UUID) {
        guard let request = requests[id], let header = String(data: request.bytes, encoding: .utf8) else {
            respond(id, code: 400, reason: "Bad Request")
            return
        }
        let lines = header.components(separatedBy: "\r\n")
        let pieces = (lines.first ?? "").split(separator: " ")
        guard pieces.count == 3, ["HTTP/1.1", "HTTP/1.0"].contains(String(pieces[2])) else {
            respond(id, code: 400, reason: "Bad Request"); return
        }
        let method = String(pieces[0])
        guard method == "GET" || method == "HEAD" else {
            respond(id, code: 405, reason: "Method Not Allowed"); return
        }
        // Prevent a public website from reaching this origin through DNS rebinding.
        let host = lines.dropFirst().first { $0.lowercased().hasPrefix("host:") }?
            .dropFirst(5).trimmingCharacters(in: .whitespacesAndNewlines)
        guard let port, host == "127.0.0.1:\(port)" else {
            respond(id, code: 403, reason: "Forbidden"); return
        }
        let target = String(pieces[1]).components(separatedBy: "?")[0]
        guard target.hasPrefix("/"), !target.hasPrefix("//"),
              let decoded = target.removingPercentEncoding,
              !decoded.contains("\0"), !decoded.contains("\\") else {
            respond(id, code: 400, reason: "Bad Request"); return
        }
        let relative = decoded == "/" ? "index.html" : String(decoded.dropFirst())
        let file = root.appendingPathComponent(relative).standardizedFileURL.resolvingSymlinksInPath()
        guard file.path.hasPrefix(root.path + "/") else {
            respond(id, code: 403, reason: "Forbidden"); return
        }
        var directory = ObjCBool(false)
        guard FileManager.default.fileExists(atPath: file.path, isDirectory: &directory), !directory.boolValue,
              let data = try? Data(contentsOf: file, options: .mappedIfSafe) else {
            respond(id, code: 404, reason: "Not Found"); return
        }
        let types = ["html": "text/html; charset=utf-8", "js": "application/javascript; charset=utf-8",
                     "css": "text/css; charset=utf-8", "json": "application/json", "wasm": "application/wasm",
                     "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif",
                     "svg": "image/svg+xml", "webp": "image/webp", "ktx2": "image/ktx2", "xml": "application/xml"]
        respond(id, code: 200, reason: "OK", data: data,
                contentType: types[file.pathExtension.lowercased()] ?? "application/octet-stream", head: method == "HEAD")
    }

    private func respond(_ id: UUID, code: Int, reason: String, data: Data = Data(), contentType: String = "text/plain", head: Bool = false) {
        guard let request = requests[id] else { return }
        let header = "HTTP/1.1 \(code) \(reason)\r\nContent-Type: \(contentType)\r\nContent-Length: \(data.count)\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n"
        var response = Data(header.utf8)
        if !head { response.append(data) }
        request.connection.send(content: response, completion: .contentProcessed { [weak self] _ in self?.finish(id) })
    }

    private func finish(_ id: UUID) {
        guard let request = requests.removeValue(forKey: id) else { return }
        request.timeout?.cancel()
        request.connection.stateUpdateHandler = nil
        request.connection.cancel()
    }
}
