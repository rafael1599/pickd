#!/usr/bin/env python3
"""
Report Generator - Compilador de MD a HTML para informes academicos
Convierte archivos markdown en una carpeta 'sections/' a un informe HTML interactivo.
"""

import os
import re
import json
import webbrowser
import http.server
import socketserver
import sys
import argparse
from pathlib import Path
from functools import partial

try:
    import yaml
except ImportError:
    print("Error: PyYAML no esta instalado. Ejecuta: pip install pyyaml")
    sys.exit(1)

# Colores para terminal
GREEN = '\033[92m'
RED = '\033[91m'
YELLOW = '\033[93m'
BLUE = '\033[94m'
RESET = '\033[0m'


class MarkdownToHTML:
    """Convierte markdown a HTML siguiendo reglas especificas."""

    def __init__(self, img_dir="img"):
        self.img_dir = img_dir
        self.figure_count = 0
        self.table_count = 0
        self._pending_comment = None

    def convert(self, md_content):
        """Convierte markdown a HTML."""
        lines = md_content.split('\n')
        html_lines = []
        in_list = False
        list_type = None

        i = 0
        while i < len(lines):
            line = lines[i]

            # Ignorar ## (h2) - viene del YAML
            if line.strip().startswith('## '):
                i += 1
                continue

            # ### -> h3
            if line.strip().startswith('### '):
                if in_list:
                    html_lines.append(f'</{list_type}>')
                    in_list = False
                title = line.strip()[4:].strip()
                html_lines.append(f'<h3>{self._format_inline(title)}</h3>')
                i += 1
                continue

            # #### -> h4
            if line.strip().startswith('#### '):
                if in_list:
                    html_lines.append(f'</{list_type}>')
                    in_list = False
                title = line.strip()[5:].strip()
                html_lines.append(f'<h4>{self._format_inline(title)}</h4>')
                i += 1
                continue

            # Comentario HTML (captura para caption de tabla)
            if line.strip().startswith('<!--') and '-->' in line:
                self._pending_comment = line.strip()
                i += 1
                continue

            # Tabla markdown
            if line.strip().startswith('|'):
                table_html = self._parse_table(lines, i)
                html_lines.append(table_html['html'])
                i = table_html['next_line']
                continue

            # Bloque de codigo
            if line.strip().startswith('```'):
                code_block = self._parse_code_block(lines, i)
                html_lines.append(code_block['html'])
                i = code_block['next_line']
                continue

            # Blockquote
            if line.strip().startswith('> '):
                if in_list:
                    html_lines.append(f'</{list_type}>')
                    in_list = False
                quote_text = line.strip()[2:].strip()
                html_lines.append(f'<blockquote><p>{self._format_inline(quote_text)}</p></blockquote>')
                i += 1
                continue

            # Lista desordenada
            if line.strip().startswith('- '):
                if not in_list or list_type != 'ul':
                    if in_list:
                        html_lines.append(f'</{list_type}>')
                    html_lines.append('<ul>')
                    in_list = True
                    list_type = 'ul'

                item_text = line.strip()[2:].strip()
                html_lines.append(f'<li>{self._format_inline(item_text)}</li>')
                i += 1
                continue

            # Lista ordenada
            if re.match(r'^\d+\.\s', line.strip()):
                if not in_list or list_type != 'ol':
                    if in_list:
                        html_lines.append(f'</{list_type}>')
                    html_lines.append('<ol>')
                    in_list = True
                    list_type = 'ol'

                item_text = re.sub(r'^\d+\.\s', '', line.strip())
                html_lines.append(f'<li>{self._format_inline(item_text)}</li>')
                i += 1
                continue

            # Parrafo normal (acumula lineas consecutivas)
            if line.strip() and not in_list:
                if in_list:
                    html_lines.append(f'</{list_type}>')
                    in_list = False
                para_lines = []
                while i < len(lines) and lines[i].strip() and not self._is_block_element(lines[i]):
                    para_lines.append(lines[i].strip())
                    i += 1
                formatted = self._format_inline(' '.join(para_lines))
                if formatted.strip().startswith('<figure>'):
                    html_lines.append(formatted)
                else:
                    html_lines.append(f'<p>{formatted}</p>')
                continue

            # Linea vacia
            if not line.strip():
                if in_list:
                    html_lines.append(f'</{list_type}>')
                    in_list = False
                i += 1
                continue

            i += 1

        if in_list:
            html_lines.append(f'</{list_type}>')

        return '\n    '.join(html_lines)

    def _is_block_element(self, line):
        """Detecta si una linea inicia un bloque que no debe unirse a un parrafo."""
        s = line.strip()
        if s.startswith('## ') or s.startswith('### ') or s.startswith('#### '):
            return True
        if s.startswith('- ') or re.match(r'^\d+\.\s', s):
            return True
        if s.startswith('|') or s.startswith('```') or s.startswith('> '):
            return True
        if s.startswith('<!--') and '-->' in s:
            return True
        if s.startswith('!['):
            return True
        return False

    def _make_figure(self, match):
        """Genera HTML de figura con numeracion y fuente."""
        self.figure_count += 1
        alt_text = match.group(1)
        img_file = match.group(2)
        src = f'{self.img_dir}/{os.path.basename(img_file)}'

        # Soporta alt con fuente: ![Descripcion|Fuente: Texto](img.png)
        if '|' in alt_text:
            description, source = alt_text.split('|', 1)
            description = description.strip()
            source = source.strip()
        else:
            description = alt_text
            source = 'Fuente: Elaboracion propia'

        return (
            f'<figure>'
            f'<img src="{src}" alt="{description}">'
            f'<figcaption>Figura {self.figure_count}: {description}.<br>{source}.</figcaption>'
            f'</figure>'
        )

    def _format_inline(self, text):
        """Aplica formato inline: negrita, cursiva, links, imagenes."""
        # Imagenes: ![alt](archivo.png) -> <figure> con caption numerado
        text = re.sub(
            r'!\[([^\]]*)\]\(([^\)]+)\)',
            self._make_figure,
            text
        )

        # Links: [texto](url) -> <a href="url">texto</a>
        text = re.sub(
            r'\[([^\]]+)\]\(([^\)]+)\)',
            lambda m: f'<a href="{m.group(2)}">{m.group(1)}</a>',
            text
        )

        # Negrita: **texto** -> <strong>texto</strong>
        text = re.sub(r'\*\*([^\*]+)\*\*', r'<strong>\1</strong>', text)

        # Cursiva: *texto* -> <em>texto</em>
        text = re.sub(r'\*([^\*]+)\*', r'<em>\1</em>', text)

        return text

    def _parse_table(self, lines, start_idx):
        """Parsea tabla markdown."""
        table_lines = []
        i = start_idx

        while i < len(lines) and lines[i].strip().startswith('|'):
            table_lines.append(lines[i])
            i += 1

        if len(table_lines) < 2:
            return {'html': '', 'next_line': i}

        # Parsear encabezado
        header_cells = [cell.strip() for cell in table_lines[0].split('|')[1:-1]]

        # Parsear cuerpo
        body_lines = table_lines[2:]  # Saltar separador
        body_cells = []
        for line in body_lines:
            cells = [cell.strip() for cell in line.split('|')[1:-1]]
            if cells:
                body_cells.append(cells)

        # Generar HTML con numeracion
        self.table_count += 1

        # Extraer caption de comentario HTML previo: <!-- tabla: Descripcion -->
        caption_text = ''
        if self._pending_comment:
            match_cap = re.search(r'<!--\s*tabla:\s*(.+?)\s*-->', self._pending_comment, re.IGNORECASE)
            if match_cap:
                caption_text = match_cap.group(1).strip()
            self._pending_comment = None

        if caption_text:
            caption_str = f'Tabla {self.table_count}: {caption_text}.'
        else:
            caption_str = f'Tabla {self.table_count}.'

        html = f'<div class="table-wrapper">\n'
        html += f'<p class="table-caption">{caption_str}</p>\n'
        html += '<table>\n'
        html += '<thead>\n<tr>'
        for cell in header_cells:
            html += f'<th>{self._format_inline(cell)}</th>'
        html += '</tr>\n</thead>\n'

        html += '<tbody>\n'
        for row in body_cells:
            html += '<tr>'
            for cell in row:
                html += f'<td>{self._format_inline(cell)}</td>'
            html += '</tr>\n'
        html += '</tbody>\n</table>\n</div>'

        return {'html': html, 'next_line': i}

    def _parse_code_block(self, lines, start_idx):
        """Parsea bloque de codigo."""
        code_lines = []
        i = start_idx + 1

        while i < len(lines) and not lines[i].strip().startswith('```'):
            code_lines.append(lines[i])
            i += 1

        code_content = '\n'.join(code_lines)
        html = f'<pre><code>{code_content}</code></pre>'

        return {'html': html, 'next_line': i + 1}


class ReportBuilder:
    """Compilador principal de reportes."""

    def __init__(self, project_dir='.'):
        self.project_dir = Path(project_dir).resolve()
        self.config_file = self.project_dir / 'report.yaml'
        self.sections_dir = self.project_dir / 'sections'
        self.img_dir = self.project_dir / 'img'
        self.css_dir = self.project_dir / 'css'
        self.index_file = self.project_dir / 'index.html'

    def _render_integrantes(self):
        """Genera HTML para integrantes o estudiante individual."""
        if 'integrantes' in self.config and isinstance(self.config['integrantes'], list):
            items = ''.join(f'<li>{i}</li>' for i in self.config['integrantes'])
            return f'<p><strong>Integrantes:</strong></p><ul class="integrantes-list">{items}</ul>'
        elif 'estudiante' in self.config:
            return f'<p><strong>Estudiante:</strong> {self.config["estudiante"]}</p>'
        return ''

    def validate(self):
        """Valida la estructura del proyecto."""
        print(f"\n{BLUE}Validando estructura...{RESET}")

        if not self.config_file.exists():
            print(f"{RED}X No se encontro report.yaml{RESET}")
            return False

        try:
            with open(self.config_file, 'r', encoding='utf-8') as f:
                self.config = yaml.safe_load(f)
        except yaml.YAMLError as e:
            print(f"{RED}X Error en YAML: {e}{RESET}")
            return False

        # Validar campos obligatorios
        required = ['titulo', 'curso', 'profesor', 'fecha', 'logo', 'secciones']
        missing = [field for field in required if field not in self.config]

        if missing:
            print(f"{RED}X Faltan campos en report.yaml: {', '.join(missing)}{RESET}")
            return False

        if not isinstance(self.config['secciones'], list):
            print(f"{RED}X 'secciones' debe ser una lista{RESET}")
            return False

        # Validar que existan archivos markdown
        missing_files = []
        for section in self.config['secciones']:
            md_file = self.sections_dir / f"{section['id']}.md"
            if not md_file.exists():
                missing_files.append(f"sections/{section['id']}.md")

        if missing_files:
            print(f"{RED}X Faltan archivos:{RESET}")
            for f in missing_files:
                print(f"  - {f}")
            return False

        print(f"{GREEN}OK Estructura valida{RESET}")
        return True

    def build(self):
        """Compila el informe."""
        if not self.validate():
            return False

        print(f"\n{BLUE}Compilando informe...{RESET}")

        # Crear directorio CSS si no existe
        self.css_dir.mkdir(exist_ok=True)

        # Convertir secciones markdown a HTML
        section_htmls = {}
        converter = MarkdownToHTML()

        for section in self.config['secciones']:
            md_file = self.sections_dir / f"{section['id']}.md"
            html_file = self.sections_dir / f"{section['id']}.html"

            print(f"  Procesando: {section['id']}...", end=" ")

            try:
                with open(md_file, 'r', encoding='utf-8') as f:
                    md_content = f.read()

                html_content = converter.convert(md_content)

                section_html = f"""<section>
    <h2>{section['titulo']}</h2>
    {html_content}
</section>"""

                with open(html_file, 'w', encoding='utf-8') as f:
                    f.write(section_html)

                section_htmls[section['id']] = True
                print(f"{GREEN}OK{RESET}")
            except Exception as e:
                print(f"{RED}X Error: {e}{RESET}")
                return False

        # Generar index.html
        print(f"  Generando index.html...", end=" ")

        try:
            section_ids = [s['id'] for s in self.config['secciones']]

            html_template = f"""<!DOCTYPE html>
<html lang="es">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{self.config['titulo']}</title>
    <link rel="stylesheet" href="css/base.css">
    <link rel="stylesheet" href="css/layout.css">
    <link rel="stylesheet" href="css/visuals.css">
    <link rel="stylesheet" href="css/print.css" media="print">
</head>

<body>
    <header>
        <img src="{self.config['logo']}" alt="Logo">
        <h1>{self.config['titulo']}</h1>
        <p><strong>Curso:</strong> {self.config['curso']}</p>
        <p><strong>Profesor(a):</strong> {self.config['profesor']}</p>
        {self._render_integrantes()}
        <p><strong>Fecha:</strong> {self.config['fecha']}</p>
    </header>

    <div class="report-container">
        <main>
"""

            for section_id in section_ids:
                html_template += f'            <section id="{section_id}"></section>\n'

            html_template += f"""        </main>

        <script>
            const sections = {json.dumps(section_ids)};

            Promise.all(sections.map(section => fetch(`sections/${{section}}.html`).then(r => r.text())))
                .then(htmls => {{
                    htmls.forEach((data, i) => {{
                        const sectionElement = document.getElementById(sections[i]);
                        if (sectionElement) {{
                            sectionElement.innerHTML = data;
                        }}
                    }});
                }})
                .catch(error => console.error('Error al cargar las secciones:', error));
        </script>
    </div>
</body>

</html>"""

            with open(self.index_file, 'w', encoding='utf-8') as f:
                f.write(html_template)

            print(f"{GREEN}OK{RESET}")
        except Exception as e:
            print(f"{RED}X Error: {e}{RESET}")
            return False

        print(f"\n{GREEN}OK Informe compilado exitosamente{RESET}")
        return True

    def serve(self, port=8080):
        """Levanta servidor HTTP."""
        print(f"\n{BLUE}Iniciando servidor...{RESET}")

        handler = partial(http.server.SimpleHTTPRequestHandler, directory=str(self.project_dir))

        for p in range(port, port + 10):
            try:
                with socketserver.TCPServer(("", p), handler) as httpd:
                    url = f"http://localhost:{p}"
                    print(f"{GREEN}OK Servidor activo en {url}{RESET}")
                    print(f"{YELLOW}Abre el navegador y presiona Ctrl+P para exportar a PDF{RESET}")
                    print(f"{YELLOW}Presiona Ctrl+C para detener el servidor{RESET}\n")

                    webbrowser.open(url)

                    try:
                        httpd.serve_forever()
                    except KeyboardInterrupt:
                        print(f"\n{YELLOW}Servidor detenido.{RESET}")
                    return
            except OSError:
                continue

        print(f"{RED}X No se encontro un puerto disponible entre {port} y {port + 9}{RESET}")


def main():
    parser = argparse.ArgumentParser(description='Report Generator - Compilador MD a HTML')
    parser.add_argument('--build', action='store_true', help='Solo compilar (sin servidor)')
    parser.add_argument('--serve', action='store_true', help='Solo levantar servidor (sin compilar)')
    parser.add_argument('--port', type=int, default=8080, help='Puerto del servidor (default: 8080)')
    args = parser.parse_args()

    builder = ReportBuilder()

    # Sin flags: compilar + servir (comportamiento original)
    if not args.build and not args.serve:
        if builder.build():
            builder.serve(args.port)
        else:
            sys.exit(1)
    elif args.build:
        if not builder.build():
            sys.exit(1)
    elif args.serve:
        builder.serve(args.port)


if __name__ == '__main__':
    main()
