import os
import shutil
import subprocess
import rcssmin
import re
import json
from pathlib import Path

def ensure_build_dir():
    build_dir = Path('build_extension')
    if build_dir.exists():
        shutil.rmtree(build_dir)
    build_dir.mkdir()
    return build_dir

def minify_css(content):
    return rcssmin.cssmin(content)

def clean_html(content):
    # Remove HTML comments
    content = re.sub(r'<!--[\s\S]*?-->', '', content)
    # Remove unnecessary whitespace
    content = re.sub(r'\s+', ' ', content)
    return content.strip()

def obfuscate_js(input_file, output_file):
    result = subprocess.run([
        'javascript-obfuscator',
        input_file,
        '--output', output_file,
        '--compact', 'true',
        '--self-defending', 'false',
        '--control-flow-flattening', 'false',
        '--dead-code-injection', 'false',
        '--debug-protection', 'false',
        '--debug-protection-interval', '0',
        '--disable-console-output', 'true',
        '--log', 'false',
        '--numbers-to-expressions', 'true',
        '--rename-globals', 'true',
        '--split-strings', 'false',
        '--string-array', 'false',
        '--string-array-threshold', '1',
        '--string-array-index-shift', 'false',
        '--string-array-rotate', 'false',
        '--string-array-shuffle', 'false',
        '--simplify', 'true',
    ], capture_output=True, text=True)
    if result.returncode != 0:
        print("Obfuscation failed.")
        exit(1)

def main():
    extension_dir = Path('extension')
    build_dir = ensure_build_dir()

    # Process all files in extension directory
    for file in extension_dir.glob('*'):
        if file.is_file():
            output_file = build_dir / file.name
            # Process based on file extension
            if file.suffix == '.css':
                with open(file, 'r', encoding='utf-8') as f:
                    css_content = f.read()
                minified_css = minify_css(css_content)
                with open(output_file, 'w', encoding='utf-8') as f:
                    f.write(minified_css)
                print(f'Minified CSS: {file.name}')
            # elif file.suffix == '.js':
            #     obfuscate_js(str(file), str(output_file))
            #     print(f'Obfuscated JS: {file.name}')
            elif file.suffix == '.json':
                with open(file, 'r', encoding='utf-8') as f:
                    json_content = f.read()
                json_content = json_content.replace('  ', '').replace('\n', '')
                with open(output_file, 'w', encoding='utf-8') as f:
                    f.write(json_content)
                print(f'Processed JSON: {file.name}')
            elif file.suffix == '.html':
                with open(file, 'r', encoding='utf-8') as f:
                    html_content = f.read()
                cleaned_html = clean_html(html_content)
                with open(output_file, 'w', encoding='utf-8') as f:
                    f.write(cleaned_html)
                print(f'Cleaned HTML: {file.name}')
            else:
                shutil.copy2(file, output_file)
                print(f'Copied file: {file.name}')

if __name__ == '__main__':
    os.system('clear')
    main()