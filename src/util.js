export function clickSelector(s) {
  setTimeout(() => {
    const node = document.querySelector(s);
    if (node) {
      node.click();
    }
  }, 500);
}
