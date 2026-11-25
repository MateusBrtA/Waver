import React, { useState } from 'react';
import { Flame, HardDrive, Loader2, Repeat, UploadCloud, X } from 'lucide-react';
import { ApiClient } from '../lib/api';
import { FileTransfer } from '../types';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

interface FileTransferModalProps {
  api: ApiClient;
  targetLabel: string;
  onUploaded: (transfer: FileTransfer, caption: string) => void;
  onClose: () => void;
}

export const FileTransferModal: React.FC<FileTransferModalProps> = ({
  api,
  targetLabel,
  onUploaded,
  onClose,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [oneTime, setOneTime] = useState(false);
  const [caption, setCaption] = useState('');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState({ percent: 0, loaded: 0, total: 0, speedMBps: 0 });
  const [error, setError] = useState('');

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    if (file.size > 1.85 * 1024 * 1024 * 1024) {
      setError('O limite máximo por arquivo é 1.85 GB para respeitar o teto total de 2 GB do cache.');
      return;
    }
    setUploading(true);
    setError('');
    try {
      const { transfer } = await api.uploadHeavyTransfer(file, oneTime, (p) => setProgress(p));
      onUploaded(transfer, caption.trim());
      onClose();
    } catch (err: unknown) {
      setError((err as Error).message || 'Falha ao enviar arquivo.');
      setUploading(false);
    }
  };

  return (
    <div
      onClick={() => !uploading && onClose()}
      className="fixed inset-0 z-[95] bg-black/75 flex items-center justify-center p-4"
    >
      <form
        onSubmit={handleUpload}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-[#2b2d31] border border-[#3f4147] rounded-lg shadow-2xl overflow-hidden"
      >
        <div className="px-5 py-4 bg-[#232428] border-b border-[#1e1f22] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-[#5865f2]/20 text-[#5865f2]">
              <HardDrive className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Enviar Arquivo Pesado (até 1.85 GB)</h3>
              <p className="text-xs text-[#949ba4]">Transferência em alta velocidade LAN para {targetLabel}</p>
            </div>
          </div>
          {!uploading && (
            <button type="button" onClick={onClose} className="p-1 text-[#949ba4] hover:text-white cursor-pointer">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        <div className="p-5 space-y-4">
          {/* File Dropzone */}
          <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-[#4e5058] hover:border-[#5865f2] bg-[#1e1f22] rounded-lg p-6 cursor-pointer text-center transition">
            <UploadCloud className="w-9 h-9 text-[#5865f2]" />
            {file ? (
              <div>
                <div className="text-sm font-bold text-white break-all">{file.name}</div>
                <div className="text-xs text-[#4ade80] font-mono mt-0.5">{formatBytes(file.size)}</div>
              </div>
            ) : (
              <div>
                <div className="text-sm font-bold text-white">Clique para escolher qualquer arquivo</div>
                <div className="text-xs text-[#949ba4] mt-0.5">
                  ZIP, RAR, MP4, ISO, saves, mods — até 1.85 GB • Cache automático sob 2 GB
                </div>
              </div>
            )}
            <input
              type="file"
              disabled={uploading}
              className="hidden"
              onChange={(e) => {
                setFile(e.target.files?.[0] || null);
                setError('');
              }}
            />
          </label>

          {/* Transfer Mode: Reusable vs One-Time Self-Destruct! */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              disabled={uploading}
              onClick={() => setOneTime(false)}
              className={`p-3.5 rounded-lg border-2 text-left transition cursor-pointer ${
                !oneTime
                  ? 'bg-[#5865f2]/20 border-[#5865f2] text-white'
                  : 'bg-[#1e1f22] border-[#3f4147] text-[#b5bac1] hover:border-[#6d6f78]'
              }`}
            >
              <Repeat className="w-5 h-5 mb-1.5 text-[#5865f2]" />
              <div className="text-sm font-bold text-white">Download Disponível</div>
              <div className="text-[11px] text-[#949ba4] mt-0.5">
                Vários amigos podem baixar quando quiserem (até o cache auto-limpar).
              </div>
            </button>

            <button
              type="button"
              disabled={uploading}
              onClick={() => setOneTime(true)}
              className={`p-3.5 rounded-lg border-2 text-left transition cursor-pointer ${
                oneTime
                  ? 'bg-[#f97316]/20 border-[#f97316] text-white'
                  : 'bg-[#1e1f22] border-[#3f4147] text-[#b5bac1] hover:border-[#6d6f78]'
              }`}
            >
              <Flame className="w-5 h-5 mb-1.5 text-[#f97316]" />
              <div className="text-sm font-bold text-white">Download Único 🔥</div>
              <div className="text-[11px] text-[#949ba4] mt-0.5">
                Apaga do disco automaticamente logo após o 1º download (zero cache!).
              </div>
            </button>
          </div>

          <input
            type="text"
            disabled={uploading}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Mensagem opcional acompanhando o arquivo..."
            maxLength={240}
            className="w-full bg-[#1e1f22] border border-[#3f4147] focus:border-[#5865f2] rounded-lg px-3.5 py-2.5 text-sm text-white outline-none"
          />

          {/* Live Transfer Speed Progress Bar */}
          {uploading && (
            <div className="bg-[#1e1f22] rounded-lg p-3.5 space-y-2 border border-[#5865f2]/40">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-white flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#5865f2]" />
                  Enviando... {progress.percent}%
                </span>
                <span className="font-mono text-[#4ade80]">
                  {progress.speedMBps > 0 ? `${progress.speedMBps} MB/s` : 'Calculando...'}
                </span>
              </div>
              <div className="h-2.5 bg-[#2b2d31] rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[#5865f2] to-[#23a55a] transition-all duration-150"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
              <div className="text-[11px] font-mono text-[#949ba4] flex justify-between">
                <span>{formatBytes(progress.loaded)}</span>
                <span>{formatBytes(progress.total)}</span>
              </div>
            </div>
          )}

          {error && (
            <div className="text-xs bg-[#da373c]/15 border border-[#da373c]/40 text-[#ff9396] px-3 py-2 rounded-lg">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3.5 bg-[#232428] border-t border-[#1e1f22] flex justify-end gap-2">
          {!uploading && (
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-[#dbdee1] hover:underline cursor-pointer"
            >
              Cancelar
            </button>
          )}
          <button
            type="submit"
            disabled={!file || uploading}
            className="px-5 py-2 bg-[#5865f2] hover:bg-[#4752c4] disabled:opacity-50 text-white text-xs font-bold rounded-lg flex items-center gap-2 cursor-pointer"
          >
            {uploading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {uploading ? 'Transferindo...' : oneTime ? 'Enviar (Download Único 🔥)' : 'Enviar Arquivo'}
          </button>
        </div>
      </form>
    </div>
  );
};
