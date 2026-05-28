/** Page-Context (React-State auf mobile.de). */
export function getUnsafeWindow() {
    try {
        return typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    } catch (e) {
        return window;
    }
}
