const fs = require('fs');
const path = require('path');

const srcIndexPath = path.join(__dirname, '../src/index.js');
const outputIndexPath = path.join(__dirname, '../src/index.built.js');
const panelHtmlPath = path.join(__dirname, '../panel/panel.html');
const panelCssPath = path.join(__dirname, '../panel/style.css');
const panelJsPath = path.join(__dirname, '../panel/script.js');

try {
    console.log('Reading source files...');
    let indexContent = fs.readFileSync(srcIndexPath, 'utf8');
    const panelHtmlContent = fs.readFileSync(panelHtmlPath, 'utf8');
    const panelCssContent = fs.readFileSync(panelCssPath, 'utf8');
    const panelJsContent = fs.readFileSync(panelJsPath, 'utf8');

    console.log('Injecting panel content into placeholders...');

    // Escape backticks, backslashes, and ${} sequences in the content
    // to avoid issues when injecting into template literals or strings.
    const escapeContent = (content) => {
        return content
            .replace(/\\/g, '\\\\') // Escape backslashes first
            .replace(/`/g, '\\`')  // Escape backticks
            .replace(/\$/g, '\\$'); // Escape dollar signs (for ${})
             // Add more escapes if needed (e.g., for specific comment sequences if they cause issues)
    };

    // Replace the placeholder constants with the actual escaped content
    // Use backticks for multiline strings in the final code
    indexContent = indexContent.replace(
        'const panelTemplateHtml_PLACEHOLDER = "__PANEL_HTML_PLACEHOLDER__";',
        `const panelTemplateHtml_PLACEHOLDER = \`${escapeContent(panelHtmlContent)}\`;`
    );
    indexContent = indexContent.replace(
        'const panelCss_PLACEHOLDER = "__PANEL_CSS_PLACEHOLDER__";',
        `const panelCss_PLACEHOLDER = \`${escapeContent(panelCssContent)}\`;`
    );
    indexContent = indexContent.replace(
        'const panelJs_PLACEHOLDER = "__PANEL_JS_PLACEHOLDER__";',
        `const panelJs_PLACEHOLDER = \`${escapeContent(panelJsContent)}\`;`
    );

    console.log(`Writing prepared file to ${outputIndexPath}...`);
    fs.writeFileSync(outputIndexPath, indexContent, 'utf8');

    console.log('Preparation successful!');

} catch (error) {
    console.error('Error during build preparation:', error);
    process.exit(1); // Exit with error code
}
