import React, { useState, useRef, useEffect } from 'react';
import {
  MapPin,
  Search,
  Trash2,
  Loader2,
  Sparkles,
  AlertCircle,
  Upload,
  Image as ImageIcon,
  X,
  HelpCircle,
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Layers,
} from 'lucide-react';

const TOKYO_WARDS: string[] = [
  'Adachi (足立)',
  'Arakawa (荒川)',
  'Bunkyo (文京)',
  'Chiyoda (千代田)',
  'Chuo (中央)',
  'Edogawa (江戸川)',
  'Itabashi (板橋)',
  'Katsushika (葛飾)',
  'Kita (北)',
  'Koto (江東)',
  'Meguro (目黒)',
  'Minato (港)',
  'Nakano (中野)',
  'Nerima (練馬)',
  'Ota (大田)',
  'Setagaya (世田谷)',
  'Shibuya (渋谷)',
  'Shinagawa (品川)',
  'Shinjuku (新宿)',
  'Suginami (杉並)',
  'Sumida (墨田)',
  'Taito (台東)',
  'Toshima (豊島)',
];

interface ProcessedImage {
  base64: string;
  mimeType: string;
  previewUrl: string;
  width: number;
  height: number;
  fileName: string;
}

export interface SortingResultPart {
  part: string;
  category:
    | 'burnable'
    | 'non_burnable'
    | 'resource_paper'
    | 'resource_bottles_cans'
    | 'resource_pet'
    | 'plastic'
    | 'oversized'
    | 'drop_off'
    | 'not_collected'
    | 'unknown';
  category_ja: string;
  prep_steps: string[];
  kb_reference: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface SortingResult {
  item_name: string;
  materials: string[];
  parts: SortingResultPart[];
  warnings: string[];
  not_in_kb: boolean;
  follow_up_question: string | null;
}

export default function App() {
  const [selectedWard, setSelectedWard] = useState<string>('Shibuya (渋谷)');
  const [item, setItem] = useState<string>('');
  const [image, setImage] = useState<ProcessedImage | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [result, setResult] = useState<SortingResult | null>(null);
  const [error, setError] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Downscale image to ~1500px on the long side before storing
  const processImageFile = (file: File): Promise<ProcessedImage> => {
    return new Promise((resolve, reject) => {
      if (!file.type.startsWith('image/')) {
        return reject(new Error('Please upload an image file (e.g. JPG, PNG, WebP).'));
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          let width = img.width;
          let height = img.height;
          const maxDimension = 1500;

          if (width > maxDimension || height > maxDimension) {
            if (width >= height) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            } else {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            return reject(new Error('Failed to obtain canvas context.'));
          }

          ctx.drawImage(img, 0, 0, width, height);
          const mimeType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
          const dataUrl = canvas.toDataURL(mimeType, 0.85);
          const base64 = dataUrl.split(',')[1];

          resolve({
            base64,
            mimeType,
            previewUrl: dataUrl,
            width,
            height,
            fileName: file.name || 'uploaded-photo.jpg',
          });
        };
        img.onerror = () => reject(new Error('Failed to load image for processing.'));
        img.src = event.target?.result as string;
      };
      reader.onerror = () => reject(new Error('Failed to read image file.'));
      reader.readAsDataURL(file);
    });
  };

  const handleFileSelection = async (file: File) => {
    try {
      setError('');
      const processed = await processImageFile(file);
      setImage(processed);
    } catch (err: any) {
      setError(err?.message || 'Failed to process selected image.');
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelection(file);
    }
  };

  const removeImage = () => {
    setImage(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Support paste (Ctrl+V / Cmd+V)
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (e.clipboardData?.items) {
        for (const clipboardItem of Array.from(e.clipboardData.items)) {
          if (clipboardItem.type.startsWith('image/')) {
            const file = clipboardItem.getAsFile();
            if (file) {
              handleFileSelection(file);
              break;
            }
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      handleFileSelection(file);
    }
  };

  const handleCheck = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const hasText = Boolean(item.trim());
    const hasImg = Boolean(image);

    if ((!hasText && !hasImg) || loading) return;

    setLoading(true);
    setError('');
    setResult(null);

    try {
      const res = await fetch('/api/sort', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          item: item.trim(),
          ward: selectedWard,
          image: image
            ? {
                base64: image.base64,
                mimeType: image.mimeType,
              }
            : null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to sort item. Please try again.');
      }

      if (data.result) {
        setResult(data.result);
      } else {
        throw new Error('Invalid response structure received from assistant.');
      }
    } catch (err: any) {
      setError(err?.message || 'Something went wrong while checking the item.');
    } finally {
      setLoading(false);
    }
  };

  const sampleItems = [
    'plastic hanger',
    'PET bottle with cap and label',
    'broken ceramic mug',
    'aluminum beverage can',
    'cooking oil plastic bottle',
    'mobile battery power bank',
  ];

  // Map category to color badges as specified:
  // burnable red, non-burnable blue, resources green, plastic yellow, oversized purple, not collected grey
  const getCategoryStyles = (category: SortingResultPart['category']) => {
    switch (category) {
      case 'burnable':
        return {
          badgeText: 'Burnable',
          badgeBg: 'bg-red-600 text-white',
          rowBorder: 'border-red-200',
          accentColor: 'text-red-700',
          lightBg: 'bg-red-50/50',
        };
      case 'non_burnable':
        return {
          badgeText: 'Non-burnable',
          badgeBg: 'bg-blue-600 text-white',
          rowBorder: 'border-blue-200',
          accentColor: 'text-blue-700',
          lightBg: 'bg-blue-50/50',
        };
      case 'resource_paper':
        return {
          badgeText: 'Resources (Paper)',
          badgeBg: 'bg-emerald-600 text-white',
          rowBorder: 'border-emerald-200',
          accentColor: 'text-emerald-700',
          lightBg: 'bg-emerald-50/50',
        };
      case 'resource_bottles_cans':
        return {
          badgeText: 'Resources (Bottles/Cans)',
          badgeBg: 'bg-emerald-600 text-white',
          rowBorder: 'border-emerald-200',
          accentColor: 'text-emerald-700',
          lightBg: 'bg-emerald-50/50',
        };
      case 'resource_pet':
        return {
          badgeText: 'Resources (PET Bottle)',
          badgeBg: 'bg-emerald-600 text-white',
          rowBorder: 'border-emerald-200',
          accentColor: 'text-emerald-700',
          lightBg: 'bg-emerald-50/50',
        };
      case 'plastic':
        return {
          badgeText: 'Plastic Resource',
          badgeBg: 'bg-yellow-500 text-slate-900 font-bold',
          rowBorder: 'border-yellow-300',
          accentColor: 'text-yellow-800',
          lightBg: 'bg-yellow-50/60',
        };
      case 'oversized':
        return {
          badgeText: 'Oversized',
          badgeBg: 'bg-purple-600 text-white',
          rowBorder: 'border-purple-200',
          accentColor: 'text-purple-700',
          lightBg: 'bg-purple-50/50',
        };
      case 'drop_off':
        return {
          badgeText: 'Drop-off Box',
          badgeBg: 'bg-gray-600 text-white',
          rowBorder: 'border-gray-200',
          accentColor: 'text-gray-700',
          lightBg: 'bg-gray-50',
        };
      case 'not_collected':
        return {
          badgeText: 'Not Collected',
          badgeBg: 'bg-gray-600 text-white',
          rowBorder: 'border-gray-300',
          accentColor: 'text-gray-700',
          lightBg: 'bg-gray-50',
        };
      case 'unknown':
      default:
        return {
          badgeText: 'Unknown',
          badgeBg: 'bg-gray-500 text-white',
          rowBorder: 'border-gray-200',
          accentColor: 'text-gray-600',
          lightBg: 'bg-gray-50',
        };
    }
  };

  const getConfidenceStyle = (confidence: 'high' | 'medium' | 'low') => {
    switch (confidence) {
      case 'high':
        return 'bg-emerald-100 text-emerald-800 border-emerald-300';
      case 'medium':
        return 'bg-amber-100 text-amber-800 border-amber-300';
      case 'low':
      default:
        return 'bg-slate-100 text-slate-700 border-slate-300';
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white shadow-xs">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center text-white shadow-sm">
              <Trash2 className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
                <span>GOMIRENZ</span>
                <span className="text-emerald-700 font-medium text-base">ゴミレンズ</span>
              </h1>
              <p className="text-xs text-slate-500">One man&apos;s trash is another man&apos;s treasure</p>
            </div>
          </div>
          <span className="text-xs font-medium px-2.5 py-1 bg-emerald-50 text-emerald-800 rounded-full border border-emerald-200">
            Tokyo 23 Wards
          </span>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-8">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8 space-y-6">
          {/* 1. Dropdown of Tokyo's 23 wards in English with Japanese in brackets */}
          <div>
            <label htmlFor="ward-select" className="block text-sm font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
              <MapPin className="w-4 h-4 text-emerald-600" />
              <span>Select Ward (特別区)</span>
            </label>
            <div className="relative">
              <select
                id="ward-select"
                value={selectedWard}
                onChange={(e) => setSelectedWard(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 hover:border-slate-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 rounded-xl px-4 py-3 text-slate-800 font-medium text-base appearance-none transition-colors outline-none cursor-pointer"
              >
                {TOKYO_WARDS.map((ward) => (
                  <option key={ward} value={ward}>
                    {ward}
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-slate-500">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              Sorting rules and collection days differ across Tokyo&apos;s 23 municipal wards.
            </p>
          </div>

          {/* 2. Text box + Upload Trash Photo + Drag & Drop zone */}
          <form onSubmit={handleCheck} className="space-y-4">
            <div>
              <label htmlFor="item-input" className="block text-sm font-semibold text-slate-700 mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Search className="w-4 h-4 text-emerald-600" />
                  <span>Item to Sort</span>
                </span>
                <span className="text-xs text-slate-400 font-normal">Photo or text</span>
              </label>

              {/* Input row: Text box with Upload Trash Photo button next to it */}
              <div className="flex flex-col sm:flex-row gap-2.5">
                <div className="relative flex-1">
                  <input
                    id="item-input"
                    type="text"
                    value={item}
                    onChange={(e) => setItem(e.target.value)}
                    placeholder="Type an item, e.g. 'plastic hanger'"
                    className="w-full bg-slate-50 border border-slate-300 hover:border-slate-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 rounded-xl px-4 py-3 text-slate-900 text-base placeholder:text-slate-400 transition-colors outline-none"
                  />
                </div>

                {/* Upload Trash Photo button (no capture attribute so desktop opens file dialog) */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileInputChange}
                  className="hidden"
                  id="trash-photo-input"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center justify-center gap-2 px-4 py-3 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 hover:border-emerald-400 font-medium text-sm rounded-xl transition-colors shrink-0 cursor-pointer"
                >
                  <Upload className="w-4 h-4" />
                  <span>Upload Trash Photo</span>
                </button>
              </div>
            </div>

            {/* Drag & drop zone / paste area */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-3.5 sm:p-4 text-center cursor-pointer transition-all ${
                isDragging
                  ? 'border-emerald-500 bg-emerald-50/70 scale-[0.99]'
                  : 'border-slate-300 hover:border-emerald-400 bg-slate-50/60 hover:bg-emerald-50/30'
              }`}
            >
              <div className="flex items-center justify-center gap-2 text-xs text-slate-600">
                <ImageIcon className="w-4 h-4 text-emerald-600" />
                <span>
                  Drag &amp; drop trash photo here, or paste with{' '}
                  <kbd className="px-1.5 py-0.5 text-[10px] bg-white border border-slate-300 rounded shadow-2xs font-mono text-slate-700">
                    Ctrl
                  </kbd>{' '}
                  +{' '}
                  <kbd className="px-1.5 py-0.5 text-[10px] bg-white border border-slate-300 rounded shadow-2xs font-mono text-slate-700">
                    V
                  </kbd>
                </span>
              </div>
            </div>

            {/* Thumbnail Preview with Remove Button */}
            {image && (
              <div className="flex items-center gap-3.5 p-3 bg-emerald-50/70 border border-emerald-200 rounded-xl">
                <div className="relative w-16 h-16 rounded-lg overflow-hidden bg-white border border-emerald-200 shadow-2xs shrink-0">
                  <img
                    src={image.previewUrl}
                    alt="Trash item thumbnail"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{image.fileName}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Ready for analysis &bull; Resized to {image.width}&times;{image.height}px
                  </p>
                </div>
                <button
                  type="button"
                  onClick={removeImage}
                  className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 text-rose-700 hover:text-rose-800 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Remove</span>
                </button>
              </div>
            )}

            {/* Quick Suggestions */}
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-xs text-slate-500 mr-1 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-amber-500" /> Examples:
              </span>
              {sampleItems.map((sample) => (
                <button
                  type="button"
                  key={sample}
                  onClick={() => setItem(sample)}
                  className="text-xs bg-slate-100 hover:bg-emerald-50 hover:text-emerald-800 hover:border-emerald-200 border border-slate-200 text-slate-700 px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
                >
                  {sample}
                </button>
              ))}
            </div>

            {/* Check Button */}
            <div>
              <button
                type="submit"
                disabled={loading || (!item.trim() && !image)}
                className="w-full sm:w-auto min-w-[140px] bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-6 py-3 rounded-xl shadow-xs transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Checking rules...</span>
                  </>
                ) : (
                  <span>Check</span>
                )}
              </button>
            </div>
          </form>

          {/* Error Message */}
          {error && (
            <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm flex items-start gap-2.5">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Notice</p>
                <p className="text-xs mt-0.5 text-red-600">{error}</p>
              </div>
            </div>
          )}

          {/* Follow-up question shown above the result card if set */}
          {result && result.follow_up_question && (
            <div className="p-4 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 flex items-start gap-3 shadow-2xs">
              <HelpCircle className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="text-xs font-bold uppercase tracking-wider text-blue-600 mb-0.5">
                  Follow-up Question
                </div>
                <p className="text-sm font-medium">{result.follow_up_question}</p>
                <p className="text-xs text-blue-600 mt-1">
                  You can refine your input in the text box above to confirm sizing or materials.
                </p>
              </div>
            </div>
          )}

          {/* 3. Structured Result Card */}
          {result && (
            <div className="mt-6 pt-6 border-t border-slate-200 space-y-5">
              {/* Not in KB banner if applicable */}
              {result.not_in_kb && (
                <div className="p-4 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-sm">Not in my sources — check your ward&apos;s official guide</p>
                    <p className="text-xs text-amber-700 mt-0.5">
                      This item or specific ward variation is not detailed in our verified knowledge base. Please verify with your local municipal collection calendar or ward app.
                    </p>
                  </div>
                </div>
              )}

              {/* Result Card Header */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold text-slate-900 capitalize">
                      {result.item_name || item || 'Checked Item'}
                    </h2>
                    <span className="text-xs bg-emerald-100 text-emerald-800 font-medium px-2 py-0.5 rounded-md">
                      {selectedWard}
                    </span>
                  </div>
                  {result.materials && result.materials.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                      <span className="text-xs text-slate-500 flex items-center gap-1">
                        <Layers className="w-3 h-3" /> Materials:
                      </span>
                      {result.materials.map((mat, idx) => (
                        <span
                          key={idx}
                          className="text-[11px] bg-white border border-slate-200 text-slate-700 px-2 py-0.5 rounded-md font-medium"
                        >
                          {mat}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="text-xs text-slate-500 text-right shrink-0">
                  <span>{result.parts.length} part{result.parts.length > 1 ? 's' : ''} to sort</span>
                </div>
              </div>

              {/* Rows: One row per part */}
              <div className="space-y-3.5">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Sorting Breakdown by Component
                </div>

                {result.parts.map((part, index) => {
                  const styles = getCategoryStyles(part.category);
                  const confidenceClass = getConfidenceStyle(part.confidence);

                  return (
                    <div
                      key={index}
                      className={`p-4 sm:p-5 rounded-xl border ${styles.rowBorder} ${styles.lightBg} transition-all space-y-3`}
                    >
                      {/* Top row: Part name, Category badges, Japanese name, Confidence chip */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          {/* Part name */}
                          <span className="text-base font-bold text-slate-900 capitalize">
                            {part.part}
                          </span>

                          {/* Coloured bin badge */}
                          <span
                            className={`text-xs px-2.5 py-1 rounded-md font-semibold tracking-tight shadow-2xs ${styles.badgeBg}`}
                          >
                            {styles.badgeText}
                          </span>

                          {/* Japanese bin name */}
                          <span className="text-xs font-bold bg-white text-slate-800 border border-slate-300 px-2 py-0.5 rounded-md">
                            {part.category_ja}
                          </span>
                        </div>

                        {/* Confidence chip */}
                        <div className="flex items-center gap-2 shrink-0">
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider ${confidenceClass}`}
                          >
                            {part.confidence} confidence
                          </span>
                        </div>
                      </div>

                      {/* Prep steps */}
                      {part.prep_steps && part.prep_steps.length > 0 && (
                        <div className="pt-1">
                          <p className="text-xs font-semibold text-slate-600 mb-1 flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Preparation Steps:</span>
                          </p>
                          <ul className="list-disc list-inside text-xs text-slate-700 space-y-0.5 pl-1">
                            {part.prep_steps.map((step, sIdx) => (
                              <li key={sIdx} className="leading-relaxed">
                                {step}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Source reference */}
                      <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between text-xs text-slate-500">
                        <span className="flex items-center gap-1">
                          <BookOpen className="w-3.5 h-3.5 text-slate-400" />
                          <span>Source: {part.kb_reference || 'Knowledge Base'}</span>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Warnings in an orange box */}
              {result.warnings && result.warnings.length > 0 && (
                <div className="p-4 rounded-xl bg-orange-50 border border-orange-300 text-orange-950 space-y-1.5 shadow-2xs">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-orange-800">
                    <AlertTriangle className="w-4 h-4 text-orange-600 shrink-0" />
                    <span>Important Warnings &amp; Guidelines</span>
                  </div>
                  <ul className="list-disc list-inside text-xs text-orange-900 space-y-1 pl-1">
                    {result.warnings.map((w, wIdx) => (
                      <li key={wIdx} className="leading-relaxed">
                        {w}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="mt-6 text-center text-xs text-slate-400">
          GOMIRENZ / ゴミレンズ &bull; Tokyo 23 Wards Household Waste Guide &bull; Version 1.0
        </div>
      </main>
    </div>
  );
}
