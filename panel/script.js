// panel/script.js

/**
 * Copies the provided text to the clipboard and provides visual feedback on the button.
 * @param {HTMLButtonElement} button The button element that was clicked.
 * @param {string} text The text to copy.
 */
function copyToClipboard(button, text) {
  if (!navigator.clipboard) {
    // Fallback for older browsers or insecure contexts (http)
    console.warn('Clipboard API not available. Falling back (if possible).');
    // You could implement a textarea-based fallback here, but it's often unreliable.
    alert('Clipboard API is not available in this context.');
    return;
  }

  const originalText = button.textContent;
  const originalBg = button.style.backgroundColor;
  const originalBorder = button.style.borderColor;
  const originalColor = button.style.color;

  // Disable button during operation
  button.disabled = true;
  button.classList.remove('error', 'copied'); // Reset classes

  navigator.clipboard.writeText(text).then(() => {
    console.log('Text copied to clipboard successfully!');
    button.textContent = 'Copied!';
    button.classList.add('copied'); // Use class for styling feedback

    setTimeout(() => {
      button.textContent = originalText;
      button.classList.remove('copied');
      button.disabled = false; // Re-enable
    }, 1500); // Increased timeout slightly

  }).catch(err => {
    console.error('Failed to copy text: ', err);
    button.textContent = 'Error!';
    button.classList.add('error'); // Use class for styling feedback

    setTimeout(() => {
      button.textContent = originalText;
      button.classList.remove('error');
      button.disabled = false; // Re-enable
    }, 2500); // Longer timeout for error message
  });
}

// No need for DOMContentLoaded listener here anymore,
// as script is injected at the end of the body.
console.log("Panel script loaded.");
