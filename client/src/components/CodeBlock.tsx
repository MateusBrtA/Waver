import React, { useState } from 'react';
import { Check, ChevronDown, ChevronUp, Code2, Copy } from 'lucide-react';
import { formatLanguageLabel, tokenizeCodeLine } from '../lib/codeDetect';

interface CodeBlockProps {
  language: string;
  code: string;
  autoDetected?: boolean;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({ language, code, autoDetected }) => {
  const [copied, setCopied] = useState(false);
  const lines = code.split(/\r?\n/);
  const [collapsed, setCollapsed] = useState(lines.length > 26);

  const displayLines = collapsed ? lines.slice(0, 14) : lines;

  const handleCopy = () => {
    navigator.clipboard.writeText(code).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="my-2 max-w-2xl rounded-lg overflow-hidden border border-[#2c3142] bg-[#0d1017] shadow-lg">
      {/* Header bar with detected language badge */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#2b2d31] border-b border-[#404249] text-[11px]">
        <div className="flex items-center gap-2">
          <Code2 className="w-3.5 h-3.5 text-[#5865f2]" />
          <span className="font-bold text-[#dbdee1] tracking-wide">{formatLanguageLabel(language)}</span>
          {autoDetected && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#5865f2]/20 text-[#a5b4fc] font-semibold">
              Detectado
            </span>
          )}
          <span className="text-[#64748b] font-mono">{lines.length} linhas</span>
        </div>

        <div className="flex items-center gap-1.5">
          {lines.length > 26 && (
            <button
              type="button"
              onClick={() => setCollapsed((v) => !v)}
              className="px-2 py-0.5 rounded bg-[#1f2433] hover:bg-[#2a3145] text-[#dbdee1] flex items-center gap-1 cursor-pointer"
            >
              {collapsed ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
              {collapsed ? 'Expandir' : 'Recolher'}
            </button>
          )}
          <button
            type="button"
            onClick={handleCopy}
            className="px-2 py-0.5 rounded bg-[#1f2433] hover:bg-[#5865f2] text-[#dbdee1] hover:text-white flex items-center gap-1 transition cursor-pointer"
          >
            {copied ? <Check className="w-3 h-3 text-[#4ade80]" /> : <Copy className="w-3 h-3" />}
            {copied ? 'Copiado' : 'Copiar'}
          </button>
        </div>
      </div>

      {/* Syntax-highlighted code */}
      <pre className="p-3 overflow-x-auto text-[12px] leading-[1.5] font-mono m-0 select-text">
        <code>
          {displayLines.map((line, i) => {
            const tokens = tokenizeCodeLine(line, language);
            return (
              <div key={i} className="flex">
                <span className="w-8 shrink-0 pr-3 text-right text-[#475569] select-none text-[11px]">
                  {i + 1}
                </span>
                <span className="flex-1 whitespace-pre">
                  {tokens.length > 0 ? (
                    tokens.map((t, j) => (
                      <span key={j} className={t.cls}>
                        {t.text}
                      </span>
                    ))
                  ) : (
                    ' '
                  )}
                </span>
              </div>
            );
          })}
        </code>
      </pre>

      {collapsed && (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="w-full py-1.5 bg-[#121622] hover:bg-[#1a2033] text-[11px] font-semibold text-[#94a3b8] hover:text-white border-t border-[#404249] cursor-pointer"
        >
          Mostrar todas as {lines.length} linhas...
        </button>
      )}
    </div>
  );
};
