import React, { useState } from 'react';
import confetti from 'canvas-confetti';

export const EasterEggWoodFish: React.FC = () => {
  const [count, setCount] = useState<number>(0);
  const [floatingTexts, setFloatingTexts] = useState<{ id: number; text: string }[]>([]);
  const [isOpen, setIsOpen] = useState<boolean>(false);

  const blessings = [
    '功德 +1 🎯',
    '题感 +1 ⚡',
    '考神附体 🌟',
    '算无遗策 📐',
    '逢考必过 💯',
    '几何直觉 +1 📐',
    '数论通关 👑',
    '今晚加鸡腿 🍗',
    '卓越必胜 🚀'
  ];

  const handleTap = () => {
    const nextCount = count + 1;
    setCount(nextCount);

    const randomBlessing = blessings[Math.floor(Math.random() * blessings.length)];
    const newId = Date.now();
    setFloatingTexts(prev => [...prev.slice(-4), { id: newId, text: randomBlessing }]);

    setTimeout(() => {
      setFloatingTexts(prev => prev.filter(item => item.id !== newId));
    }, 1200);

    // Mini confetti on multiples of 10
    if (nextCount % 10 === 0) {
      confetti({
        particleCount: 40,
        spread: 60,
        origin: { y: 0.85, x: 0.92 }
      });
    }
  };

  return (
    <div className="no-print fixed bottom-28 right-3.5 z-30">
      {/* Floating texts */}
      <div className="relative pointer-events-none">
        {floatingTexts.map((item) => (
          <div
            key={item.id}
            className="absolute bottom-14 right-4 text-xs font-bold text-amber-600 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200 shadow-sm animate-bounce whitespace-nowrap"
          >
            {item.text}
          </div>
        ))}
      </div>

      {isOpen ? (
        <div className="bg-white rounded-3xl p-4 shadow-xl border border-slate-200 flex flex-col items-center space-y-2 animate-in fade-in zoom-in-90 w-44">
          <div className="flex items-center justify-between w-full text-[11px] font-bold text-slate-500 pb-1 border-b border-slate-100">
            <span>备考解压小木鱼</span>
            <button onClick={() => setIsOpen(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
              &times;
            </button>
          </div>

          <button
            onClick={handleTap}
            className="w-16 h-16 rounded-2xl bg-amber-50 hover:bg-amber-100 border-2 border-amber-300 text-3xl flex items-center justify-center transition-transform active:scale-90 shadow-inner cursor-pointer select-none"
            title="敲一下，考点+1"
          >
            🪵
          </button>

          <div className="text-[11px] font-mono font-bold text-slate-600">
            已积攒福气: <span className="text-amber-600">{count}</span>
          </div>
          <p className="text-[10px] text-slate-400 text-center">
            刷题累了敲两下，心静神定
          </p>
        </div>
      ) : (
        <button
          onClick={() => setIsOpen(true)}
          className="w-12 h-12 rounded-full bg-white hover:bg-amber-50 text-slate-700 border border-slate-200 shadow-lg flex items-center justify-center text-xl transition-transform hover:scale-110 active:scale-95 cursor-pointer group"
          title="备考解压彩蛋"
        >
          <span>🪵</span>
        </button>
      )}
    </div>
  );
};
