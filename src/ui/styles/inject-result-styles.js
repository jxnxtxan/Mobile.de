import resultCss from './result.css?inline';

export function injectResultStyles() {
    if (document.getElementById('mobilede-result-style')) return;
    const st = document.createElement('style');
    st.id = 'mobilede-result-style';
    st.textContent = resultCss;
    document.head.appendChild(st);
}
