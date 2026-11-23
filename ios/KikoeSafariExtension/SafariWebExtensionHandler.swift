import os.log
import SafariServices

/// Native side of the Safari Web Extension. Kikoe's extension never calls
/// `runtime.sendNativeMessage`, so this only acknowledges requests; the
/// extension itself is the plain WebExtension bundle copied from `safari/`.
final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem
        let message = request?.userInfo?[SFExtensionMessageKey]
        os_log(.default, "Kikoe extension native message: %@", String(describing: message))

        let response = NSExtensionItem()
        response.userInfo = [SFExtensionMessageKey: ["echo": message as Any]]
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }
}
