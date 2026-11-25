export type CodeSegment =
  | { type: 'text'; content: string }
  | { type: 'code'; language: string; code: string; autoDetected?: boolean };

const LANG_ALIASES: Record<string, string> = {
  cs: 'csharp',
  'c#': 'csharp',
  csharp: 'csharp',
  cpp: 'cpp',
  'c++': 'cpp',
  c: 'c',
  h: 'cpp',
  hpp: 'cpp',
  hlsl: 'hlsl',
  glsl: 'glsl',
  shader: 'hlsl',
  shaderlab: 'hlsl',
  gd: 'gdscript',
  gdscript: 'gdscript',
  ts: 'typescript',
  tsx: 'typescript',
  typescript: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  javascript: 'javascript',
  py: 'python',
  python: 'python',
  lua: 'lua',
  json: 'json',
  css: 'css',
  html: 'html',
  xml: 'html',
  sql: 'sql',
  sh: 'bash',
  bash: 'bash',
  ps1: 'powershell',
  powershell: 'powershell',
};

export function formatLanguageLabel(lang: string): string {
  const map: Record<string, string> = {
    csharp: 'C#',
    cpp: 'C++',
    c: 'C',
    hlsl: 'HLSL Shader',
    glsl: 'GLSL Shader',
    gdscript: 'GDScript',
    typescript: 'TypeScript',
    javascript: 'JavaScript',
    python: 'Python',
    lua: 'Lua',
    json: 'JSON',
    css: 'CSS',
    html: 'HTML / XML',
    sql: 'SQL',
    bash: 'Bash',
    powershell: 'PowerShell',
    text: 'Código',
  };
  return map[lang] || lang.toUpperCase();
}

export function normalizeLang(raw: string): string {
  const k = (raw || '').trim().toLowerCase();
  return LANG_ALIASES[k] || k || 'text';
}

/**
 * Heuristically detects if a pasted plain snippet is source code & identifies its language (especially C#/Unity, C++, HLSL/GLSL, GDScript, etc. for game devs!).
 */
export function detectCodeLanguage(input: string): string | null {
  const trimmed = (input || '').trim();
  if (!trimmed || trimmed.length < 18) return null;
  if (/^https?:\/\/\S+$/i.test(trimmed)) return null;

  const lines = trimmed.split(/\r?\n/);
  const hasCodePunctuation = /[{};()=>]|::|->|^\s*(using|import|#include|def |func |class |public |private |shader|Shader|SELECT )/m.test(
    trimmed
  );
  if (lines.length < 2 && !/^(using\s+[\w.]+;|public\s+class\s+|#include\s+<|Shader\s+")/i.test(trimmed)) {
    return null;
  }
  if (!hasCodePunctuation) return null;

  // Game dev Shaders (HLSL / GLSL / Unity ShaderLab)
  if (/\b(Shader\s+"|SubShader|CGPROGRAM|ENDCG|HLSLPROGRAM|float[234]\b|fixed[234]\b|half[234]\b|tex2D\(|SV_Target|SV_POSITION)/m.test(trimmed)) {
    return 'hlsl';
  }
  if (/\b(gl_Position|gl_FragColor|vec[234]\b|mat[234]\b|uniform\s+sampler2D|#version\s+\d+)/m.test(trimmed)) {
    return 'glsl';
  }

  // C# (.NET / Unity / Godot C#)
  if (
    /\b(using\s+(System|UnityEngine|TMPro|Godot)|namespace\s+[\w.]+|MonoBehaviour|\[SerializeField\]|SerializedProperty|void\s+(Start|Update|FixedUpdate|Awake)\s*\(|IEnumerator\s+\w+|public\s+(class|struct|interface|enum)\s+\w+|async\s+Task\b|Console\.WriteLine)/m.test(
      trimmed
    ) ||
    (/\b(public|private|protected|internal)\s+(static\s+|override\s+|virtual\s+)?[\w<>[\]]+\s+\w+\s*[\(=;{]/m.test(trimmed) &&
      /;/.test(trimmed))
  ) {
    return 'csharp';
  }

  // C++ (Unreal / OpenGL / Native)
  if (/#include\s*[<"]|std::|UPROPERTY|UFUNCTION|UCLASS|nullptr|->\w+\(|template\s*</m.test(trimmed)) {
    return 'cpp';
  }

  // Godot GDScript
  if (/\b(extends\s+\w+|func\s+_\w+\s*\(|onready\s+var|@export\s+var|@onready)\b/m.test(trimmed)) {
    return 'gdscript';
  }

  // JSON
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {}
  }

  // TypeScript / JavaScript
  if (/\b(interface\s+\w+|type\s+\w+\s*=|:\s*(string|number|boolean|React\.FC))\b/m.test(trimmed)) {
    return 'typescript';
  }
  if (/\b(const|let|var)\s+\w+\s*=|function\s+\w+\(|=>\s*\{|export\s+(default|const|function)/m.test(trimmed)) {
    return 'javascript';
  }

  // Python
  if (/^\s*(def\s+\w+\(.*\):|class\s+\w+.*:|from\s+\w+\s+import\s+|import\s+\w+)\s*$/m.test(trimmed)) {
    return 'python';
  }

  // Lua (Roblox / Love2D / FiveM)
  if (/\b(local\s+function\b|local\s+\w+\s*=.*\bthen\b|elseif\b.*\bthen\b|\bend\b)/m.test(trimmed) && !/;/.test(trimmed)) {
    return 'lua';
  }

  // CSS
  if (/^\s*([.#:]?[\w-]+|\*)\s*\{[^}]*:[^}]*\}/m.test(trimmed)) {
    return 'css';
  }

  // Generic braced multi-line code fallback
  if (lines.length >= 3 && /\{[\s\S]*\}/.test(trimmed) && /;/.test(trimmed)) {
    return 'csharp';
  }

  return null;
}

/**
 * Splits a message into markdown text + fenced code blocks (or auto-detected pasted code!).
 */
export function parseMessageSegments(content: string): CodeSegment[] {
  if (!content) return [];
  const fenceRe = /```([a-zA-Z0-9#_+.-]*)\r?\n([\s\S]*?)```/g;
  const segments: CodeSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = fenceRe.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: content.slice(lastIndex, match.index) });
    }
    const rawLang = match[1] || '';
    const code = match[2].replace(/\r?\n$/, '');
    const lang = rawLang ? normalizeLang(rawLang) : detectCodeLanguage(code) || 'text';
    segments.push({ type: 'code', language: lang, code });
    lastIndex = fenceRe.lastIndex;
  }

  if (lastIndex < content.length) {
    const tail = content.slice(lastIndex);
    if (segments.length === 0) {
      const autoLang = detectCodeLanguage(tail);
      if (autoLang) {
        segments.push({ type: 'code', language: autoLang, code: tail.trim(), autoDetected: true });
        return segments;
      }
    }
    segments.push({ type: 'text', content: tail });
  }

  return segments;
}

const KEYWORDS = new Set([
  'using', 'namespace', 'public', 'private', 'protected', 'internal', 'static', 'readonly', 'const',
  'class', 'struct', 'interface', 'enum', 'record', 'void', 'bool', 'int', 'float', 'double', 'string',
  'var', 'let', 'function', 'async', 'await', 'return', 'if', 'else', 'elif', 'for', 'foreach', 'while',
  'switch', 'case', 'break', 'continue', 'new', 'this', 'base', 'super', 'self', 'true', 'false', 'null',
  'nullptr', 'None', 'True', 'False', 'override', 'virtual', 'abstract', 'sealed', 'import', 'from', 'export',
  'default', 'type', 'extends', 'implements', 'def', 'func', 'local', 'then', 'end', 'include', 'Shader',
  'SubShader', 'Pass', 'Properties', 'float2', 'float3', 'float4', 'half', 'fixed4', 'vec2', 'vec3', 'vec4',
  'uniform', 'in', 'out', 'try', 'catch', 'finally', 'throw', 'yield', 'Task', 'IEnumerator', 'GameObject',
  'Transform', 'Vector2', 'Vector3', 'Quaternion', 'MonoBehaviour',
]);

export interface HighlightToken {
  text: string;
  cls: string;
}

const TOKEN_RE =
  /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?[fd]?\b|\[[A-Za-z_]\w*(?:\([^\]]*\))?\]|\b[A-Za-z_]\w*\b)/g;

export function tokenizeCodeLine(line: string, language: string): HighlightToken[] {
  const out: HighlightToken[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;

  while ((m = TOKEN_RE.exec(line)) !== null) {
    if (m.index > last) {
      out.push({ text: line.slice(last, m.index), cls: 'text-[#d4d4d8]' });
    }
    const tok = m[0];
    let cls = 'text-[#d4d4d8]';
    if (tok.startsWith('//') || tok.startsWith('/*') || (tok.startsWith('#') && language !== 'cpp' && language !== 'csharp')) {
      cls = 'text-[#6a9955] italic';
    } else if (tok.startsWith('#')) {
      cls = 'text-[#c586c0]';
    } else if (tok.startsWith('"') || tok.startsWith("'") || tok.startsWith('`')) {
      cls = 'text-[#ce9178]';
    } else if (/^\d/.test(tok)) {
      cls = 'text-[#b5cea8]';
    } else if (tok.startsWith('[')) {
      cls = 'text-[#dcdcaa]';
    } else if (KEYWORDS.has(tok)) {
      cls = 'text-[#569cd6] font-semibold';
    } else if (/^[A-Z][A-Za-z0-9_]*$/.test(tok)) {
      cls = 'text-[#4ec9b0]';
    }
    out.push({ text: tok, cls });
    last = TOKEN_RE.lastIndex;
  }

  if (last < line.length) {
    out.push({ text: line.slice(last), cls: 'text-[#d4d4d8]' });
  }
  return out;
}
