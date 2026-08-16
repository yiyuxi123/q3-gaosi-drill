import React, { useEffect, useState } from 'react';
import { X, ZoomIn, ZoomOut, RotateCw } from 'lucide-react';

interface ImageLightboxModalProps {
  isOpen: boolean;
  imageUrl: string;
  title?: string;
  onClose: () => void;
}

export const ImageLightboxModal: React.FC<ImageLightboxModalProps> = ({
  isOpen,
  imageUrl,
  title,
  onClose
}) => {
  const [zoom, setZoom] = useState<number>(1);
  const [rotation, setRotation] = useState<number>(0);

  useEffect(() => {
    if (!isOpen) return;
    setZoom(1);
    setRotation(0);
  }, [isOpen, imageUrl]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !imageUrl) return null;

  const handleZoomIn = () => setZoom(prev => Math.min(prev + 0.3, 3.5));
  const handleZoomOut = () => setZoom(prev => Math.max(prev - 0.3, 0.6));
  const handleReset = () => {
    setZoom(1);
    setRotation(0);
  };
  const handleRotate = () => setRotation(prev => (prev + 90) % 360);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title || '高清图片查看器'}
      className="fixed inset-0 z-50 flex flex-col bg-slate-950/90 backdrop-blur-md animate-in fade-in select-none"
    >
      {/* Top Header Controls */}
      <div className="flex items-center justify-between p-3 sm:p-4 bg-slate-900/80 border-b border-slate-800 text-white z-10">
        <div className="text-xs font-bold text-slate-200 truncate max-w-xs sm:max-w-md">
          {title || '高清教材与解析原图'}
        </div>

        <div className="flex items-center space-x-2">
          {/* Zoom controls */}
          <button
            type="button"
            onClick={handleZoomOut}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs transition cursor-pointer"
            title="缩小"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-xs font-mono font-bold text-slate-300 w-12 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={handleZoomIn}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs transition cursor-pointer"
            title="放大"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleRotate}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs transition cursor-pointer"
            title="旋转"
          >
            <RotateCw className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="px-2.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition cursor-pointer"
          >
            重置
          </button>

          {/* Close button */}
          <button
            type="button"
            onClick={onClose}
            className="p-2 bg-rose-600/80 hover:bg-rose-600 text-white rounded-xl text-xs transition cursor-pointer ml-2"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Main Image Container */}
      <div 
        onClick={onClose} 
        className="flex-1 overflow-auto p-4 flex items-center justify-center cursor-zoom-out"
      >
        <div 
          onClick={(e) => e.stopPropagation()} 
          className="transition-transform duration-200 ease-out"
          style={{
            transform: `scale(${zoom}) rotate(${rotation}deg)`,
            transformOrigin: 'center center'
          }}
        >
          <img
            src={imageUrl}
            alt={title || '高清大图'}
            className="max-w-[90vw] max-h-[80vh] rounded-2xl shadow-2xl border border-slate-700 object-contain bg-white cursor-default"
          />
        </div>
      </div>

      {/* Bottom hint */}
      <div className="p-2.5 bg-slate-900/80 border-t border-slate-800 text-center text-[11px] text-slate-400">
        💡 提示：支持点击缩放按钮调节大小，点击空白处即可退出全屏。
      </div>
    </div>
  );
};
