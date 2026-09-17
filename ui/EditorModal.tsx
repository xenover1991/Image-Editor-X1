/*
 * ImageEditor - Developed by xen (206993987125510144)
 * Apple Dark Glassmorphism Editor Modal - Advanced Feature Suite
 */

import { chooseFile } from "@utils/web";
import { findByPropsLazy } from "@webpack";
import {
    ChannelActionCreators,
    ChannelStore,
    DraftType,
    FluxDispatcher,
    IconUtils,
    React,
    RelationshipStore,
    SelectedChannelStore,
    UploadHandler,
    UserStore,
    useEffect,
    useMemo,
    useRef,
    useState
} from "@webpack/common";

import { CanvasEngine, Point } from "../core/canvasEngine";
import { LoadedImage, loadImageSource } from "../core/imageLoader";

const SelectedChannelActionCreators = findByPropsLazy("selectPrivateChannel");

export type ToolType = 
    | "select"
    | "crop"
    | "pixelate"
    | "blur"
    | "redact"
    | "brush"
    | "arrow"
    | "rect"
    | "circle"
    | "spotlight"
    | "magnifier"
    | "step"
    | "bubble"
    | "stamp"
    | "wand"
    | "text"
    | "meme"
    | "transform"
    | "filter";

interface EditorModalProps {
    initialSource?: string | File | null;
    targetMessage?: any;
    onClose: () => void;
}

const PALETTE = [
    "#FF3B30", // Red
    "#FF9500", // Orange
    "#FFCC00", // Yellow
    "#34C759", // Green
    "#007AFF", // Blue
    "#AF52DE", // Purple
    "#FFFFFF", // White
    "#000000", // Black
];

const calculateBlockSize = (density: number) => {
    // 1 (Az piksel / 36px iri blok) -> 10 (Çok piksel / 4px yoğun mozaik)
    const d = Math.max(1, Math.min(10, Math.round(density)));
    const table = [0, 36, 30, 24, 19, 15, 12, 9, 7, 5, 4];
    return table[d] || 12;
};

export function EditorModal({ initialSource, targetMessage, onClose }: EditorModalProps) {
    const mainCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const engineRef = useRef<CanvasEngine | null>(null);
    const initialImgRef = useRef<HTMLImageElement | null>(null);
    const recipientRef = useRef<HTMLDivElement | null>(null);

    const [imageSource, setImageSource] = useState<string | File | null>(initialSource ?? null);
    const [isDragActive, setIsDragActive] = useState(false);

    // Active tool and tool parameters
    const [activeTool, setActiveTool] = useState<ToolType>("brush");
    const [color, setColor] = useState<string>("#FF3B30");
    const [lineWidth, setLineWidth] = useState<number>(5);
    const [pixelDensity, setPixelDensity] = useState<number>(6);
    const [blurRadius, setBlurRadius] = useState<number>(14);
    const [fontSize, setFontSize] = useState<number>(28);
    const [textInput, setTextInput] = useState<string>("");
    const [memeTop, setMemeTop] = useState<string>("");
    const [memeBot, setMemeBot] = useState<string>("");
    const [dimensions, setDimensions] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

    // Advanced tool states
    const [stepCounter, setStepCounter] = useState<number>(1);
    const [stampType, setStampType] = useState<"approved" | "rejected" | "bug" | "confidential" | "verified">("approved");
    const [stampScale, setStampScale] = useState<number>(1);
    const [spotlightShape, setSpotlightShape] = useState<"rect" | "circle">("rect");
    const [magnifierZoom, setMagnifierZoom] = useState<number>(2);
    const [wandTolerance, setWandTolerance] = useState<number>(30);
    const [bubbleText, setBubbleText] = useState<string>("Bunu kontrol et!");
    const [bubbleFontSize, setBubbleFontSize] = useState<number>(16);
    const [bubbleBgColor, setBubbleBgColor] = useState<string>("#007AFF");

    // Discord upload options
    const [isSpoiler, setIsSpoiler] = useState<boolean>(false);
    const [replyToMessage, setReplyToMessage] = useState<boolean>(Boolean(targetMessage));

    // History and UI
    const [canUndo, setCanUndo] = useState(false);
    const [canRedo, setCanRedo] = useState(false);
    const [zoom, setZoom] = useState<number>(100);
    const [toast, setToast] = useState<string | null>(null);

    // Recipient selection state
    const [selectedRecipient, setSelectedRecipient] = useState<any | null>(null);
    const [isRecipientOpen, setIsRecipientOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");

    // Interaction state
    const isDrawing = useRef(false);
    const startPoint = useRef<Point | null>(null);
    const brushPoints = useRef<Point[]>([]);
    const [cropRect, setCropRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

    const showToastMessage = (msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(null), 3000);
    };

    const updateHistoryStates = () => {
        if (!engineRef.current) return;
        setCanUndo(engineRef.current.canUndo());
        setCanRedo(engineRef.current.canRedo());
        setDimensions({
            w: engineRef.current.getWidth(),
            h: engineRef.current.getHeight()
        });
    };

    // Gather Friends & DM Contacts
    const availableUsers = useMemo(() => {
        const userMap = new Map<string, any>();
        const currentUserId = UserStore?.getCurrentUser?.()?.id;

        // Friends
        try {
            const friendIds = RelationshipStore?.getFriendIDs?.() ?? [];
            for (const fId of friendIds) {
                const u = UserStore?.getUser?.(fId);
                if (u && !u.bot && u.id !== currentUserId) {
                    userMap.set(u.id, u);
                }
            }
        } catch {}

        // Recent DMs
        try {
            const sorted = ChannelStore?.getSortedPrivateChannels?.() ?? [];
            for (const c of sorted) {
                if (c.isDM?.()) {
                    const rId = c.recipients?.[0] ?? c.getRecipientId?.();
                    if (rId) {
                        const u = UserStore?.getUser?.(rId);
                        if (u && !u.bot && u.id !== currentUserId) {
                            userMap.set(u.id, u);
                        }
                    }
                }
            }
        } catch {}

        return Array.from(userMap.values());
    }, [isRecipientOpen]);

    const filteredUsers = useMemo(() => {
        if (!searchQuery.trim()) return availableUsers;
        const q = searchQuery.toLowerCase();
        return availableUsers.filter(u =>
            u.username?.toLowerCase().includes(q) ||
            u.globalName?.toLowerCase().includes(q)
        );
    }, [availableUsers, searchQuery]);

    // Handle File Selection
    const handleFile = (file: File) => {
        if (!file || !file.type.startsWith("image/")) {
            showToastMessage("Lütfen geçerli bir görsel dosyası seçin.");
            return;
        }
        setImageSource(file);
        setZoom(100);
        showToastMessage("Görsel yüklendi");
    };

    const handleChooseFile = async () => {
        try {
            const file = await chooseFile("image/*");
            if (file) {
                handleFile(file);
            }
        } catch (err: any) {
            showToastMessage("Dosya seçilemedi: " + (err?.message || err));
        }
    };

    // Close Recipient Popout on Outside Click
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (recipientRef.current && !recipientRef.current.contains(e.target as Node)) {
                setIsRecipientOpen(false);
            }
        };
        if (isRecipientOpen) {
            document.addEventListener("mousedown", handleClickOutside);
        }
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [isRecipientOpen]);

    // Robust Clipboard Paste Listener (Ctrl+V anywhere in modal on document capture)
    useEffect(() => {
        const handlePaste = (e: ClipboardEvent) => {
            const files = e.clipboardData?.files;
            if (files && files.length > 0) {
                for (let i = 0; i < files.length; i++) {
                    if (files[i].type.startsWith("image/")) {
                        e.preventDefault();
                        e.stopImmediatePropagation();
                        handleFile(files[i]);
                        showToastMessage("Görsel panodan yüklendi");
                        return;
                    }
                }
            }

            const items = e.clipboardData?.items;
            if (items && items.length > 0) {
                for (let i = 0; i < items.length; i++) {
                    if (items[i].type.startsWith("image/")) {
                        const file = items[i].getAsFile();
                        if (file) {
                            e.preventDefault();
                            e.stopImmediatePropagation();
                            handleFile(file);
                            showToastMessage("Görsel panodan yüklendi");
                            return;
                        }
                    }
                }
            }
        };

        document.addEventListener("paste", handlePaste, { capture: true });
        return () => document.removeEventListener("paste", handlePaste, { capture: true });
    }, []);

    // Paste Button Handler
    const handlePasteFromClipboard = async () => {
        try {
            if (navigator.clipboard && navigator.clipboard.read) {
                const clipItems = await navigator.clipboard.read();
                for (const item of clipItems) {
                    for (const type of item.types) {
                        if (type.startsWith("image/")) {
                            const blob = await item.getType(type);
                            const file = new File([blob], `clipboard_${Date.now()}.png`, { type });
                            handleFile(file);
                            showToastMessage("Görsel panodan yüklendi");
                            return;
                        }
                    }
                }
            }
        } catch {}

        try {
            const temp = document.createElement("div");
            temp.contentEditable = "true";
            temp.style.position = "fixed";
            temp.style.left = "-9999px";
            temp.style.top = "-9999px";
            temp.style.width = "1px";
            temp.style.height = "1px";
            temp.style.opacity = "0";
            document.body.appendChild(temp);
            temp.focus();
            document.execCommand("paste");
            setTimeout(() => {
                try {
                    const img = temp.querySelector("img");
                    if (img?.src) {
                        setImageSource(img.src);
                        showToastMessage("Görsel panodan yüklendi");
                        return;
                    }
                } finally {
                    document.body.removeChild(temp);
                }
            }, 100);
        } catch {}

        showToastMessage("Görseli yapıştırmak için klavyenizden Ctrl+V tuşlarına basın.");
    };

    // Initialize Canvas & Load Image
    useEffect(() => {
        if (!imageSource) return;
        let cleanupFn: (() => void) | undefined;

        (async () => {
            try {
                const loaded: LoadedImage = await loadImageSource(imageSource);
                cleanupFn = loaded.cleanup;
                initialImgRef.current = loaded.img;

                if (mainCanvasRef.current && overlayCanvasRef.current) {
                    const engine = new CanvasEngine(mainCanvasRef.current);
                    engine.initFromImage(loaded.img, loaded.width, loaded.height);
                    engineRef.current = engine;

                    overlayCanvasRef.current.width = loaded.width;
                    overlayCanvasRef.current.height = loaded.height;

                    updateHistoryStates();
                }
            } catch (err: any) {
                showToastMessage("Resim yüklenemedi: " + (err?.message || err));
            }
        })();

        return () => {
            if (cleanupFn) cleanupFn();
        };
    }, [imageSource]);

    // Keyboard Shortcuts (Ctrl+Z, Ctrl+Y, Escape)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
                e.preventDefault();
                if (e.shiftKey) {
                    handleRedo();
                } else {
                    handleUndo();
                }
            } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
                e.preventDefault();
                handleRedo();
            } else if (e.key === "Escape") {
                if (isRecipientOpen) {
                    setIsRecipientOpen(false);
                } else {
                    onClose();
                }
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [canUndo, canRedo, isRecipientOpen]);

    const handleUndo = () => {
        if (engineRef.current?.undo()) {
            syncOverlayCanvas();
            updateHistoryStates();
        }
    };

    const handleRedo = () => {
        if (engineRef.current?.redo()) {
            syncOverlayCanvas();
            updateHistoryStates();
        }
    };

    const handleReset = () => {
        if (initialImgRef.current && engineRef.current) {
            engineRef.current.initFromImage(initialImgRef.current);
            syncOverlayCanvas();
            updateHistoryStates();
            setCropRect(null);
            showToastMessage("Orijinal haline sıfırlandı");
        }
    };

    const syncOverlayCanvas = () => {
        if (!engineRef.current || !overlayCanvasRef.current) return;
        const w = engineRef.current.getWidth();
        const h = engineRef.current.getHeight();
        if (overlayCanvasRef.current.width !== w || overlayCanvasRef.current.height !== h) {
            overlayCanvasRef.current.width = w;
            overlayCanvasRef.current.height = h;
        }
        const oCtx = overlayCanvasRef.current.getContext("2d");
        if (oCtx) oCtx.clearRect(0, 0, w, h);
    };

    // Live preview for Meme text on overlayCanvas without mutating the main canvas
    useEffect(() => {
        if (!overlayCanvasRef.current || !engineRef.current) return;

        if (activeTool !== "meme") {
            syncOverlayCanvas();
            return;
        }

        const oCanvas = overlayCanvasRef.current;
        const oCtx = oCanvas.getContext("2d");
        if (!oCtx) return;

        oCtx.clearRect(0, 0, oCanvas.width, oCanvas.height);

        if (memeTop.trim() || memeBot.trim()) {
            engineRef.current.drawMeme(memeTop, memeBot, oCtx, false);
        }
    }, [activeTool, memeTop, memeBot]);

    // Mouse to Canvas Coordinates Mapper
    const getCanvasPoint = (e: React.MouseEvent<HTMLCanvasElement>): Point => {
        const overlay = overlayCanvasRef.current;
        if (!overlay) return { x: 0, y: 0 };
        const rect = overlay.getBoundingClientRect();
        const scaleX = overlay.width / rect.width;
        const scaleY = overlay.height / rect.height;
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    };

    // --- MOUSE DOWN ---
    const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const point = getCanvasPoint(e);
        isDrawing.current = true;
        startPoint.current = point;

        if (activeTool === "brush") {
            brushPoints.current = [point];
        } else if (activeTool === "step" && engineRef.current) {
            engineRef.current.drawStepBadge(point.x, point.y, stepCounter, color);
            setStepCounter(prev => prev + 1);
            updateHistoryStates();
        } else if (activeTool === "stamp" && engineRef.current) {
            engineRef.current.drawStamp(stampType, point.x, point.y, stampScale);
            updateHistoryStates();
            showToastMessage("Damga basıldı");
        } else if (activeTool === "magnifier" && engineRef.current) {
            engineRef.current.applyMagnifier(point.x, point.y, 70, magnifierZoom);
            updateHistoryStates();
        } else if (activeTool === "wand" && engineRef.current) {
            engineRef.current.removeBackgroundColor(point.x, point.y, wandTolerance);
            updateHistoryStates();
            showToastMessage("Arka plan rengi temizlendi");
        } else if (activeTool === "text") {
            if (textInput.trim() && engineRef.current) {
                engineRef.current.drawText(textInput, point.x, point.y, fontSize, color, true);
                setTextInput("");
                updateHistoryStates();
            }
        }
    };

    // --- MOUSE MOVE ---
    const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!isDrawing.current || !startPoint.current || !overlayCanvasRef.current) return;
        const currentPoint = getCanvasPoint(e);
        const oCtx = overlayCanvasRef.current.getContext("2d");
        if (!oCtx) return;

        const w = overlayCanvasRef.current.width;
        const h = overlayCanvasRef.current.height;
        oCtx.clearRect(0, 0, w, h);

        const sx = startPoint.current.x;
        const sy = startPoint.current.y;
        const cx = currentPoint.x;
        const cy = currentPoint.y;

        const rectX = Math.round(Math.min(sx, cx));
        const rectY = Math.round(Math.min(sy, cy));
        const rectW = Math.round(Math.abs(cx - sx));
        const rectH = Math.round(Math.abs(cy - sy));

        if (activeTool === "brush") {
            brushPoints.current.push(currentPoint);
            oCtx.save();
            oCtx.strokeStyle = color;
            oCtx.lineWidth = lineWidth;
            oCtx.lineCap = "round";
            oCtx.lineJoin = "round";
            oCtx.beginPath();
            oCtx.moveTo(brushPoints.current[0].x, brushPoints.current[0].y);
            for (let i = 1; i < brushPoints.current.length; i++) {
                oCtx.lineTo(brushPoints.current[i].x, brushPoints.current[i].y);
            }
            oCtx.stroke();
            oCtx.restore();
        } else if (activeTool === "arrow" && engineRef.current) {
            engineRef.current.drawArrow(sx, sy, cx, cy, color, lineWidth, oCtx);
        } else if (activeTool === "rect") {
            oCtx.save();
            oCtx.strokeStyle = color;
            oCtx.lineWidth = lineWidth;
            oCtx.strokeRect(rectX, rectY, rectW, rectH);
            oCtx.restore();
        } else if (activeTool === "circle") {
            oCtx.save();
            oCtx.strokeStyle = color;
            oCtx.lineWidth = lineWidth;
            oCtx.beginPath();
            oCtx.ellipse(rectX + rectW / 2, rectY + rectH / 2, rectW / 2, rectH / 2, 0, 0, Math.PI * 2);
            oCtx.stroke();
            oCtx.restore();
        } else if (activeTool === "blur" && engineRef.current) {
            oCtx.save();
            if (rectW > 2 && rectH > 2) {
                oCtx.beginPath();
                oCtx.rect(rectX, rectY, rectW, rectH);
                oCtx.clip();
                oCtx.filter = `blur(${Math.max(2, blurRadius)}px)`;
                oCtx.drawImage(engineRef.current.getCanvas(), 0, 0);
            }
            oCtx.restore();

            oCtx.save();
            oCtx.setLineDash([5, 4]);
            oCtx.strokeStyle = "rgba(255, 255, 255, 0.9)";
            oCtx.lineWidth = 1.5;
            oCtx.fillStyle = "rgba(255, 255, 255, 0.08)";
            oCtx.strokeRect(rectX, rectY, rectW, rectH);
            oCtx.fillRect(rectX, rectY, rectW, rectH);
            oCtx.restore();
        } else if (activeTool === "pixelate" && engineRef.current) {
            const currentBlockSize = calculateBlockSize(pixelDensity);
            oCtx.save();
            if (rectW > 4 && rectH > 4) {
                const sW = Math.max(1, Math.round(rectW / currentBlockSize));
                const sH = Math.max(1, Math.round(rectH / currentBlockSize));
                const tempCanvas = document.createElement("canvas");
                tempCanvas.width = sW;
                tempCanvas.height = sH;
                const tCtx = tempCanvas.getContext("2d");
                if (tCtx) {
                    tCtx.drawImage(engineRef.current.getCanvas(), rectX, rectY, rectW, rectH, 0, 0, sW, sH);
                    oCtx.imageSmoothingEnabled = false;
                    oCtx.drawImage(tempCanvas, 0, 0, sW, sH, rectX, rectY, rectW, rectH);
                }
            }
            oCtx.restore();

            oCtx.save();
            oCtx.setLineDash([5, 4]);
            oCtx.strokeStyle = "rgba(255, 255, 255, 0.9)";
            oCtx.lineWidth = 1.5;
            oCtx.fillStyle = "rgba(255, 255, 255, 0.08)";
            oCtx.strokeRect(rectX, rectY, rectW, rectH);
            oCtx.fillRect(rectX, rectY, rectW, rectH);
            oCtx.restore();
        } else if (activeTool === "redact") {
            oCtx.save();
            oCtx.fillStyle = "#000000";
            oCtx.fillRect(rectX, rectY, rectW, rectH);
            oCtx.restore();
        } else if (activeTool === "spotlight") {
            oCtx.save();
            oCtx.setLineDash([6, 4]);
            oCtx.strokeStyle = "#FFD700";
            oCtx.lineWidth = 2;
            oCtx.fillStyle = "rgba(255, 215, 0, 0.15)";
            if (spotlightShape === "circle") {
                oCtx.beginPath();
                oCtx.ellipse(rectX + rectW / 2, rectY + rectH / 2, rectW / 2, rectH / 2, 0, 0, Math.PI * 2);
                oCtx.stroke();
                oCtx.fill();
            } else {
                oCtx.strokeRect(rectX, rectY, rectW, rectH);
                oCtx.fillRect(rectX, rectY, rectW, rectH);
            }
            oCtx.restore();
        } else if (activeTool === "bubble" && engineRef.current) {
            oCtx.save();
            engineRef.current.drawSpeechBubble(
                rectX, rectY, Math.max(rectW, 110), Math.max(rectH, 45),
                sx, sy,
                bubbleText || "Mesaj",
                bubbleBgColor,
                "#FFFFFF",
                bubbleFontSize,
                oCtx,
                false
            );
            oCtx.restore();
        } else if (activeTool === "crop") {
            oCtx.save();
            oCtx.fillStyle = "rgba(0, 0, 0, 0.55)";
            oCtx.fillRect(0, 0, w, h);
            oCtx.clearRect(rectX, rectY, rectW, rectH);
            oCtx.strokeStyle = "#FFFFFF";
            oCtx.lineWidth = 2;
            oCtx.setLineDash([6, 6]);
            oCtx.strokeRect(rectX, rectY, rectW, rectH);
            oCtx.restore();
            setCropRect({ x: rectX, y: rectY, w: rectW, h: rectH });
        }
    };

    // --- MOUSE UP ---
    const onMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!isDrawing.current || !startPoint.current || !engineRef.current) {
            isDrawing.current = false;
            return;
        }
        const currentPoint = getCanvasPoint(e);
        const sx = startPoint.current.x;
        const sy = startPoint.current.y;
        const cx = currentPoint.x;
        const cy = currentPoint.y;

        const rectX = Math.round(Math.min(sx, cx));
        const rectY = Math.round(Math.min(sy, cy));
        const rectW = Math.round(Math.abs(cx - sx));
        const rectH = Math.round(Math.abs(cy - sy));

        if (activeTool === "brush") {
            if (brushPoints.current.length > 1) {
                engineRef.current.drawFreehand(brushPoints.current, color, lineWidth);
            }
        } else if (activeTool === "arrow") {
            if (rectW > 5 || rectH > 5) {
                engineRef.current.drawArrow(sx, sy, cx, cy, color, lineWidth);
            }
        } else if (activeTool === "rect") {
            if (rectW > 2 && rectH > 2) {
                engineRef.current.drawRectangle(rectX, rectY, rectW, rectH, color, lineWidth, false);
            }
        } else if (activeTool === "circle") {
            if (rectW > 2 && rectH > 2) {
                engineRef.current.drawEllipse(rectX + rectW / 2, rectY + rectH / 2, rectW / 2, rectH / 2, color, lineWidth, false);
            }
        } else if (activeTool === "pixelate") {
            if (rectW > 2 && rectH > 2) {
                const currentBlockSize = calculateBlockSize(pixelDensity);
                engineRef.current.applyPixelate(rectX, rectY, rectW, rectH, currentBlockSize);
            }
        } else if (activeTool === "blur") {
            if (rectW > 2 && rectH > 2) {
                engineRef.current.applyBlur(rectX, rectY, rectW, rectH, blurRadius);
            }
        } else if (activeTool === "redact") {
            if (rectW > 2 && rectH > 2) {
                engineRef.current.applyRedact(rectX, rectY, rectW, rectH, "#000000");
            }
        } else if (activeTool === "spotlight") {
            if (rectW > 4 && rectH > 4) {
                engineRef.current.applySpotlight(rectX, rectY, rectW, rectH, spotlightShape === "circle");
                syncOverlayCanvas();
                updateHistoryStates();
                setActiveTool("brush");
                showToastMessage("Odak ışığı uygulandı ve kilitlendi");
                isDrawing.current = false;
                startPoint.current = null;
                return;
            }
        } else if (activeTool === "bubble") {
            const finalW = Math.max(rectW, 120);
            const finalH = Math.max(rectH, 48);
            // If simple click without drag, position bubble nicely above the clicked point
            const bubbleX = rectW < 15 ? sx - finalW / 2 : rectX;
            const bubbleY = rectH < 15 ? sy - finalH - 24 : rectY;
            const tailX = sx;
            const tailY = sy;

            engineRef.current.drawSpeechBubble(
                bubbleX, bubbleY, finalW, finalH,
                tailX, tailY,
                bubbleText || "Mesaj",
                bubbleBgColor,
                "#FFFFFF",
                bubbleFontSize,
                undefined,
                true
            );
            syncOverlayCanvas();
            updateHistoryStates();
            showToastMessage("Konuşma balonu eklendi");
        }

        if (activeTool !== "crop") {
            syncOverlayCanvas();
        }

        isDrawing.current = false;
        startPoint.current = null;
        brushPoints.current = [];
        updateHistoryStates();
    };

    // --- APPLY CROP ---
    const applyCrop = () => {
        if (!cropRect || !engineRef.current) return;
        engineRef.current.crop(cropRect.x, cropRect.y, cropRect.w, cropRect.h);
        setCropRect(null);
        syncOverlayCanvas();
        updateHistoryStates();
        setActiveTool("brush");
        showToastMessage("Kırpma uygulandı");
    };

    const cancelCrop = () => {
        setCropRect(null);
        syncOverlayCanvas();
        setActiveTool("brush");
    };

    // Preset Aspect Ratio / Size Setter for Crop
    const applyCropPreset = (preset: "1:1" | "16:9" | "4:3" | "9:16" | "emoji" | "sticker") => {
        if (!engineRef.current) return;
        const totalW = engineRef.current.getWidth();
        const totalH = engineRef.current.getHeight();

        let targetW = totalW;
        let targetH = totalH;

        if (preset === "1:1" || preset === "emoji" || preset === "sticker") {
            const side = Math.min(totalW, totalH);
            targetW = side;
            targetH = side;
        } else if (preset === "16:9") {
            targetW = Math.min(totalW, Math.round(totalH * (16 / 9)));
            targetH = Math.round(targetW * (9 / 16));
        } else if (preset === "4:3") {
            targetW = Math.min(totalW, Math.round(totalH * (4 / 3)));
            targetH = Math.round(targetW * (3 / 4));
        } else if (preset === "9:16") {
            targetH = Math.min(totalH, Math.round(totalW * (16 / 9)));
            targetW = Math.round(targetH * (9 / 16));
        }

        const startX = Math.round((totalW - targetW) / 2);
        const startY = Math.round((totalH - targetH) / 2);

        setCropRect({ x: startX, y: startY, w: targetW, h: targetH });

        // Draw preview on overlay canvas
        if (overlayCanvasRef.current) {
            const oCtx = overlayCanvasRef.current.getContext("2d");
            if (oCtx) {
                oCtx.clearRect(0, 0, totalW, totalH);
                oCtx.save();
                oCtx.fillStyle = "rgba(0, 0, 0, 0.55)";
                oCtx.fillRect(0, 0, totalW, totalH);
                oCtx.clearRect(startX, startY, targetW, targetH);
                oCtx.strokeStyle = "#FFFFFF";
                oCtx.lineWidth = 2;
                oCtx.setLineDash([6, 6]);
                oCtx.strokeRect(startX, startY, targetW, targetH);
                oCtx.restore();
            }
        }
    };

    // --- ROTATE & FLIP ---
    const handleRotate = (cw = true) => {
        if (!engineRef.current) return;
        engineRef.current.rotate(cw);
        syncOverlayCanvas();
        updateHistoryStates();
    };

    const handleFlip = (horizontal = true) => {
        if (!engineRef.current) return;
        engineRef.current.flip(horizontal);
        syncOverlayCanvas();
        updateHistoryStates();
    };

    // --- MEME APPLY ---
    const commitPendingChanges = () => {
        if (!engineRef.current) return;
        // If user typed meme text and hasn't committed it yet, bake it into main canvas!
        if (activeTool === "meme" && (memeTop.trim() || memeBot.trim())) {
            syncOverlayCanvas();
            engineRef.current.drawMeme(memeTop, memeBot);
            updateHistoryStates();
            setMemeTop("");
            setMemeBot("");
        }
    };

    const handleSelectTool = (newTool: ToolType) => {
        commitPendingChanges();
        setActiveTool(newTool);
    };

    const applyMeme = () => {
        if (!engineRef.current) return;
        if (!memeTop.trim() && !memeBot.trim()) {
            showToastMessage("Lütfen üst veya alt yazı girin");
            return;
        }
        syncOverlayCanvas();
        engineRef.current.drawMeme(memeTop, memeBot);
        updateHistoryStates();
        setMemeTop("");
        setMemeBot("");
        showToastMessage("Meme yazısı başarıyla eklendi");
    };

    const clearMeme = () => {
        setMemeTop("");
        setMemeBot("");
        syncOverlayCanvas();
    };

    // --- FILTERS APPLY ---
    const applyFilter = (filterType: "invert" | "grayscale" | "brightness" | "sepia") => {
        if (!engineRef.current) return;
        if (filterType === "invert") engineRef.current.applyFilters({ invert: true });
        if (filterType === "grayscale") engineRef.current.applyFilters({ grayscale: true });
        if (filterType === "sepia") engineRef.current.applyFilters({ sepia: true });
        if (filterType === "brightness") engineRef.current.applyFilters({ brightness: 125 });
        updateHistoryStates();
        showToastMessage(`Filtre uygulandı (${filterType})`);
    };

    // --- WATERMARK APPLY ---
    const handleAddWatermark = () => {
        if (!engineRef.current) return;
        engineRef.current.drawWatermark("developed by xen", "bottom-right");
        updateHistoryStates();
        showToastMessage("İmza filigranı eklendi");
    };

    // --- DYNAMIC EXPORT FILENAME ---
    const getExportFilename = () => {
        const currentUser = UserStore?.getCurrentUser?.();
        const rawUsername = currentUser?.username || "user";
        const cleanUsername = rawUsername.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
        const prefix = isSpoiler ? "SPOILER_" : "";

        let base = "";
        if (imageSource instanceof File && imageSource.name) {
            base = imageSource.name.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "_");
        } else if (typeof imageSource === "string") {
            try {
                const url = new URL(imageSource);
                const lastPart = url.pathname.substring(url.pathname.lastIndexOf("/") + 1);
                if (lastPart && !lastPart.startsWith("blob")) {
                    base = decodeURIComponent(lastPart).replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "_");
                }
            } catch {}
        }

        // Clean up any existing prefixes to prevent chaining like user_edit_user_edit...
        if (base) {
            base = base.replace(/^(SPOILER_)?xen_edit_/, "").replace(/^(SPOILER_)?xen_/, "");
            if (base.startsWith(`${cleanUsername}_`)) {
                base = base.substring(cleanUsername.length + 1);
            }
            if (base.startsWith("edit_")) {
                base = base.substring(5);
            }
        }

        if (base && base !== "clipboard" && !base.startsWith("clipboard_")) {
            return `${prefix}${cleanUsername}_edit_${base}.png`;
        }

        return `${prefix}${cleanUsername}_edit_${Date.now()}.png`;
    };

    // --- EXPORT: SEND TO DISCORD CHAT / USER ---
    const handleSend = async () => {
        if (!engineRef.current) return;
        try {
            commitPendingChanges();
            const fileName = getExportFilename();
            const file = await engineRef.current.toFile(fileName);
            let targetChannel: any = null;
            let targetChannelId: string | null = null;

            if (selectedRecipient) {
                // Find existing DM channel or create one
                const privateChannels = ChannelStore?.getSortedPrivateChannels?.() ?? [];
                const existingDM = privateChannels.find(
                    (c: any) => c.isDM?.() && (c.recipients?.includes(selectedRecipient.id) || c.getRecipientId?.() === selectedRecipient.id)
                );

                if (existingDM) {
                    targetChannelId = existingDM.id;
                    targetChannel = existingDM;
                } else if (ChannelActionCreators?.openPrivateChannel) {
                    targetChannelId = await ChannelActionCreators.openPrivateChannel(selectedRecipient.id);
                    targetChannel = ChannelStore?.getChannel?.(targetChannelId);
                }

                if (targetChannelId && SelectedChannelActionCreators?.selectPrivateChannel) {
                    SelectedChannelActionCreators.selectPrivateChannel(targetChannelId);
                }
            } else {
                targetChannelId = SelectedChannelStore.getChannelId();
                targetChannel = ChannelStore.getChannel(targetChannelId);
            }

            if (!targetChannel) {
                showToastMessage("Hedef sohbet kanalı açılamadı.");
                return;
            }

            // Message Reply Integration
            if (replyToMessage && targetMessage) {
                FluxDispatcher.dispatch({
                    type: "CREATE_PENDING_REPLY",
                    channel: targetChannel,
                    message: targetMessage,
                    shouldMention: true,
                    showMentionToggle: true
                });
            }

            UploadHandler.promptToUpload([file], targetChannel, DraftType.ChannelMessage);
            onClose();
        } catch (err: any) {
            showToastMessage("Gönderme hatası: " + (err?.message || err));
        }
    };

    // --- EXPORT: COPY TO CLIPBOARD ---
    const handleCopyToClipboard = async () => {
        if (!engineRef.current) return;
        try {
            commitPendingChanges();
            const blob = await engineRef.current.toBlob();
            await navigator.clipboard.write([
                new ClipboardItem({ "image/png": blob })
            ]);
            showToastMessage("Panoya Kopyalandı!");
        } catch (err: any) {
            showToastMessage("Kopyalama başarısız: " + (err?.message || err));
        }
    };

    // --- EXPORT: DOWNLOAD ---
    const handleDownload = async () => {
        if (!engineRef.current) return;
        try {
            commitPendingChanges();
            const fileName = getExportFilename();
            const blob = await engineRef.current.toBlob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToastMessage("Resim indirildi");
        } catch (err: any) {
            showToastMessage("İndirme hatası: " + (err?.message || err));
        }
    };

    const hasImage = Boolean(dimensions.w > 0);

    return (
        <div className="xen-editor-modal">
            {toast && <div className="xen-toast-banner">{toast}</div>}

            {/* HEADER */}
            <div className="xen-editor-header">
                <div className="xen-editor-header-left">
                    <span className="xen-editor-title">Image Editor</span>
                    <span className="xen-editor-author-badge">DEVELOPED BY XEN</span>
                    {dimensions.w > 0 && (
                        <span className="xen-editor-dimensions">
                            {dimensions.w} × {dimensions.h} px
                        </span>
                    )}
                </div>

                <div className="xen-editor-header-actions">
                    <button
                        className="xen-option-btn"
                        onClick={handleChooseFile}
                        title="Bilgisayardan yeni görsel seç"
                    >
                        Görsel Seç
                    </button>

                    {hasImage && (
                        <button
                            className="xen-option-btn"
                            onClick={handleAddWatermark}
                            title="Köşeye 'developed by xen' imza filigranı ekler"
                        >
                            İmza Ekle
                        </button>
                    )}

                    {hasImage && (
                        <div style={{ display: "flex", alignItems: "center", gap: 4, marginRight: 6 }}>
                            <button
                                className="xen-option-btn"
                                onClick={() => setZoom(prev => Math.max(25, prev - 25))}
                                title="Uzaklaştır"
                            >
                                -
                            </button>
                            <button
                                className="xen-option-btn"
                                onClick={() => setZoom(100)}
                                title="Yakınlaştırmayı sıfırla (%100)"
                                style={{ minWidth: 50, justifyContent: "center" }}
                            >
                                %{zoom}
                            </button>
                            <button
                                className="xen-option-btn"
                                onClick={() => setZoom(prev => Math.min(300, prev + 25))}
                                title="Yakınlaştır"
                            >
                                +
                            </button>
                        </div>
                    )}

                    {hasImage && (
                        <>
                            <button
                                className="xen-option-btn"
                                onClick={handleUndo}
                                disabled={!canUndo}
                                style={{ opacity: canUndo ? 1 : 0.4 }}
                                title="Geri Al (Ctrl+Z)"
                            >
                                Geri Al
                            </button>
                            <button
                                className="xen-option-btn"
                                onClick={handleRedo}
                                disabled={!canRedo}
                                style={{ opacity: canRedo ? 1 : 0.4 }}
                                title="İleri Al (Ctrl+Y)"
                            >
                                İleri Al
                            </button>
                            <button className="xen-option-btn" onClick={handleReset} title="Orijinal resmi geri yükle">
                                Sıfırla
                            </button>
                        </>
                    )}

                    <button className="xen-option-btn" onClick={onClose} title="Kapat (ESC)">
                        ✕
                    </button>
                </div>
            </div>

            {/* BODY */}
            <div className="xen-editor-body">
                {/* TOOLBAR */}
                {hasImage && (
                    <div className="xen-editor-sidebar">
                        <button
                            className={`xen-tool-button ${activeTool === "brush" ? "active" : ""}`}
                            onClick={() => handleSelectTool("brush")}
                            title="Çizim / Kalem"
                        >
                            <span className="xen-tool-icon">✎</span>
                            <span className="xen-tool-label">Çiz</span>
                        </button>

                        <button
                            className={`xen-tool-button ${activeTool === "arrow" ? "active" : ""}`}
                            onClick={() => handleSelectTool("arrow")}
                            title="Ok İşareti"
                        >
                            <span className="xen-tool-icon">➔</span>
                            <span className="xen-tool-label">Ok</span>
                        </button>

                        <button
                            className={`xen-tool-button ${activeTool === "rect" ? "active" : ""}`}
                            onClick={() => handleSelectTool("rect")}
                            title="Dikdörtgen"
                        >
                            <span className="xen-tool-icon">▭</span>
                            <span className="xen-tool-label">Kutu</span>
                        </button>

                        <button
                            className={`xen-tool-button ${activeTool === "circle" ? "active" : ""}`}
                            onClick={() => handleSelectTool("circle")}
                            title="Daire"
                        >
                            <span className="xen-tool-icon">◯</span>
                            <span className="xen-tool-label">Daire</span>
                        </button>

                        <div className="xen-tool-divider" />

                        <button
                            className={`xen-tool-button ${activeTool === "spotlight" ? "active" : ""}`}
                            onClick={() => handleSelectTool("spotlight")}
                            title="Odak Işığı (Etrafı karartıp seçilen yeri aydınlatır)"
                        >
                            <span className="xen-tool-icon">◎</span>
                            <span className="xen-tool-label">Odak</span>
                        </button>

                        <button
                            className={`xen-tool-button ${activeTool === "magnifier" ? "active" : ""}`}
                            onClick={() => handleSelectTool("magnifier")}
                            title="Büyüteç Lensi (Tıklanan yeri 2x/3x büyütür)"
                        >
                            <span className="xen-tool-icon">🔍</span>
                            <span className="xen-tool-label">Büyüteç</span>
                        </button>

                        <button
                            className={`xen-tool-button ${activeTool === "step" ? "active" : ""}`}
                            onClick={() => handleSelectTool("step")}
                            title="Numaralı Adım Rozetleri (1, 2, 3...)"
                        >
                            <span className="xen-tool-icon">①</span>
                            <span className="xen-tool-label">Adım</span>
                        </button>

                        <button
                            className={`xen-tool-button ${activeTool === "bubble" ? "active" : ""}`}
                            onClick={() => handleSelectTool("bubble")}
                            title="Konuşma Balonu"
                        >
                            <span className="xen-tool-icon">🗨</span>
                            <span className="xen-tool-label">Balon</span>
                        </button>

                        <button
                            className={`xen-tool-button ${activeTool === "stamp" ? "active" : ""}`}
                            onClick={() => handleSelectTool("stamp")}
                            title="Hazır Damgalar (Onaylandı, Reddedildi, Hata, Gizli, Doğrulandı)"
                        >
                            <span className="xen-tool-icon">🏷</span>
                            <span className="xen-tool-label">Damga</span>
                        </button>

                        <button
                            className={`xen-tool-button ${activeTool === "wand" ? "active" : ""}`}
                            onClick={() => handleSelectTool("wand")}
                            title="Sihirli Değnek (Tıklanan arka planı şeffaf yapar)"
                        >
                            <span className="xen-tool-icon">🪄</span>
                            <span className="xen-tool-label">Değnek</span>
                        </button>

                        <div className="xen-tool-divider" />

                        <button
                            className={`xen-tool-button ${activeTool === "pixelate" ? "active" : ""}`}
                            onClick={() => handleSelectTool("pixelate")}
                            title="Mozaik / Sansür (Token, şifre gizleme)"
                        >
                            <span className="xen-tool-icon">▦</span>
                            <span className="xen-tool-label">Sansür</span>
                        </button>

                        <button
                            className={`xen-tool-button ${activeTool === "blur" ? "active" : ""}`}
                            onClick={() => handleSelectTool("blur")}
                            title="Bulanıklaştırma"
                        >
                            <span className="xen-tool-icon">░</span>
                            <span className="xen-tool-label">Blur</span>
                        </button>

                        <button
                            className={`xen-tool-button ${activeTool === "redact" ? "active" : ""}`}
                            onClick={() => handleSelectTool("redact")}
                            title="Siyah Bant"
                        >
                            <span className="xen-tool-icon">⬛</span>
                            <span className="xen-tool-label">Bant</span>
                        </button>

                        <div className="xen-tool-divider" />

                        <button
                            className={`xen-tool-button ${activeTool === "crop" ? "active" : ""}`}
                            onClick={() => handleSelectTool("crop")}
                            title="Kırpma & Emoji/Sticker Oranları"
                        >
                            <span className="xen-tool-icon">✂</span>
                            <span className="xen-tool-label">Kırp</span>
                        </button>

                        <button
                            className={`xen-tool-button ${activeTool === "text" ? "active" : ""}`}
                            onClick={() => handleSelectTool("text")}
                            title="Metin Ekle"
                        >
                            <span className="xen-tool-icon">T</span>
                            <span className="xen-tool-label">Yazı</span>
                        </button>

                        <button
                            className={`xen-tool-button ${activeTool === "meme" ? "active" : ""}`}
                            onClick={() => handleSelectTool("meme")}
                            title="Meme Oluşturucu"
                        >
                            <span className="xen-tool-icon">M</span>
                            <span className="xen-tool-label">Meme</span>
                        </button>

                        <button
                            className={`xen-tool-button ${activeTool === "transform" ? "active" : ""}`}
                            onClick={() => handleSelectTool("transform")}
                            title="Döndürme & Çevirme"
                        >
                            <span className="xen-tool-icon">⟳</span>
                            <span className="xen-tool-label">Döndür</span>
                        </button>

                        <button
                            className={`xen-tool-button ${activeTool === "filter" ? "active" : ""}`}
                            onClick={() => handleSelectTool("filter")}
                            title="Filtreler"
                        >
                            <span className="xen-tool-icon">⚡</span>
                            <span className="xen-tool-label">Filtre</span>
                        </button>
                    </div>
                )}

                {/* WORKSPACE */}
                <div className="xen-editor-workspace">
                    {/* TOOL OPTIONS BAR */}
                    {hasImage && (
                        <div className="xen-editor-options-bar">
                            {/* COLOR PALETTE */}
                            {["brush", "arrow", "rect", "circle", "text", "step", "bubble"].includes(activeTool) && (
                                <div className="xen-option-group">
                                    <span className="xen-option-label">Renk:</span>
                                    {PALETTE.map(pColor => (
                                        <div
                                            key={pColor}
                                            className={`xen-color-swatch ${color === pColor ? "active" : ""}`}
                                            style={{ backgroundColor: pColor }}
                                            onClick={() => setColor(pColor)}
                                        />
                                    ))}
                                </div>
                            )}

                            {/* LINE WIDTH */}
                            {["brush", "arrow", "rect", "circle"].includes(activeTool) && (
                                <div className="xen-option-group">
                                    <span className="xen-option-label">Kalınlık:</span>
                                    {[2, 5, 8, 14].map(w => (
                                        <button
                                            key={w}
                                            className={`xen-option-btn ${lineWidth === w ? "active" : ""}`}
                                            onClick={() => setLineWidth(w)}
                                        >
                                            {w}px
                                        </button>
                                    ))}
                                </div>
                            )}

                            {/* SPOTLIGHT OPTIONS */}
                            {activeTool === "spotlight" && (
                                <div className="xen-option-group">
                                    <span className="xen-option-label">Şekil:</span>
                                    <button
                                        className={`xen-option-btn ${spotlightShape === "rect" ? "active" : ""}`}
                                        onClick={() => setSpotlightShape("rect")}
                                    >
                                        Dikdörtgen
                                    </button>
                                    <button
                                        className={`xen-option-btn ${spotlightShape === "circle" ? "active" : ""}`}
                                        onClick={() => setSpotlightShape("circle")}
                                    >
                                        Daire
                                    </button>
                                    <span style={{ fontSize: 11, color: "rgba(255, 255, 255, 0.8)", textShadow: "0 0 8px rgba(255, 255, 255, 0.35)", marginLeft: 6 }}>
                                        ★ Tek seferlik seçim: Aydınlatmak istediğiniz alanı fareyle seçin (Seçim bitince otomatik kilitlenir)
                                    </span>
                                </div>
                            )}

                            {/* MAGNIFIER OPTIONS */}
                            {activeTool === "magnifier" && (
                                <div className="xen-option-group">
                                    <span className="xen-option-label">Büyütme:</span>
                                    {[2, 3, 4].map(z => (
                                        <button
                                            key={z}
                                            className={`xen-option-btn ${magnifierZoom === z ? "active" : ""}`}
                                            onClick={() => setMagnifierZoom(z)}
                                        >
                                            {z}x
                                        </button>
                                    ))}
                                    <span style={{ fontSize: 11, color: "rgba(255, 255, 255, 0.4)", marginLeft: 6 }}>
                                        (Büyütmek istediğiniz ayrıntının üzerine tıklayın)
                                    </span>
                                </div>
                            )}

                            {/* STEP BADGE OPTIONS */}
                            {activeTool === "step" && (
                                <div className="xen-option-group">
                                    <span className="xen-option-label">Sıradaki:</span>
                                    <span style={{ fontSize: 13, fontWeight: 700, color: "#FFFFFF", background: "rgba(255,255,255,0.1)", padding: "2px 8px", borderRadius: 6 }}>
                                        Adım {stepCounter}
                                    </span>
                                    <button className="xen-option-btn" onClick={() => setStepCounter(1)}>
                                        Sıfırla (1)
                                    </button>
                                    <span style={{ fontSize: 11, color: "rgba(255, 255, 255, 0.4)", marginLeft: 6 }}>
                                        (Tıkladığınız yerlere sırasıyla 1, 2, 3 rozeti eklenir)
                                    </span>
                                </div>
                            )}

                            {/* SPEECH BUBBLE OPTIONS */}
                            {activeTool === "bubble" && (
                                <div className="xen-option-group">
                                    <span className="xen-option-label">Metin:</span>
                                    <input
                                        className="xen-input-text"
                                        type="text"
                                        placeholder="Balon metni girin..."
                                        value={bubbleText}
                                        onChange={e => setBubbleText(e.target.value)}
                                        style={{ width: 170 }}
                                    />
                                    <span className="xen-option-label">Renk:</span>
                                    {[
                                        { c: "#007AFF", name: "iOS Mavi" },
                                        { c: "#34C759", name: "iOS Yeşil" },
                                        { c: "#1C1C1E", name: "Koyu Cam" },
                                        { c: "#FF3B30", name: "Kırmızı" },
                                        { c: "#AF52DE", name: "Mor" }
                                    ].map(item => (
                                        <div
                                            key={item.c}
                                            className={`xen-color-swatch ${bubbleBgColor === item.c ? "active" : ""}`}
                                            style={{ backgroundColor: item.c }}
                                            onClick={() => setBubbleBgColor(item.c)}
                                            title={item.name}
                                        />
                                    ))}
                                    <span className="xen-option-label">Yazı:</span>
                                    {[14, 16, 20, 24].map(sz => (
                                        <button
                                            key={sz}
                                            className={`xen-option-btn ${bubbleFontSize === sz ? "active" : ""}`}
                                            onClick={() => setBubbleFontSize(sz)}
                                        >
                                            {sz}px
                                        </button>
                                    ))}
                                    <span style={{ fontSize: 11, color: "rgba(255, 255, 255, 0.8)", textShadow: "0 0 8px rgba(255, 255, 255, 0.35)", marginLeft: 6 }}>
                                        (Resimde konuşmacıya tıklayın veya sürükleyin)
                                    </span>
                                </div>
                            )}

                            {/* STAMP OPTIONS */}
                            {activeTool === "stamp" && (
                                <div className="xen-option-group">
                                    <span className="xen-option-label">Damga:</span>
                                    <button
                                        className={`xen-option-btn ${stampType === "approved" ? "active" : ""}`}
                                        onClick={() => setStampType("approved")}
                                        style={{ color: "#30D158", borderColor: stampType === "approved" ? "#30D158" : undefined, textShadow: "0 0 8px rgba(48, 209, 88, 0.6)" }}
                                    >
                                        ✓ ONAYLANDI
                                    </button>
                                    <button
                                        className={`xen-option-btn ${stampType === "rejected" ? "active" : ""}`}
                                        onClick={() => setStampType("rejected")}
                                        style={{ color: "#FF453A", borderColor: stampType === "rejected" ? "#FF453A" : undefined, textShadow: "0 0 8px rgba(255, 69, 58, 0.6)" }}
                                    >
                                        ✕ REDDEDİLDİ
                                    </button>
                                    <button
                                        className={`xen-option-btn ${stampType === "bug" ? "active" : ""}`}
                                        onClick={() => setStampType("bug")}
                                        style={{ color: "#FF9F0A", borderColor: stampType === "bug" ? "#FF9F0A" : undefined, textShadow: "0 0 8px rgba(255, 159, 10, 0.6)" }}
                                    >
                                        ⚡ HATA
                                    </button>
                                    <button
                                        className={`xen-option-btn ${stampType === "confidential" ? "active" : ""}`}
                                        onClick={() => setStampType("confidential")}
                                        style={{ color: "#BF5AF2", borderColor: stampType === "confidential" ? "#BF5AF2" : undefined, textShadow: "0 0 8px rgba(191, 90, 242, 0.6)" }}
                                    >
                                        🔒 GİZLİ
                                    </button>
                                    <button
                                        className={`xen-option-btn ${stampType === "verified" ? "active" : ""}`}
                                        onClick={() => setStampType("verified")}
                                        style={{ color: "#0A84FF", borderColor: stampType === "verified" ? "#0A84FF" : undefined, textShadow: "0 0 8px rgba(10, 132, 255, 0.6)" }}
                                    >
                                        ✓ DOĞRULANDI
                                    </button>

                                    <span className="xen-option-label" style={{ marginLeft: 6 }}>Boyut:</span>
                                    {[0.8, 1, 1.3].map(sc => (
                                        <button
                                            key={sc}
                                            className={`xen-option-btn ${stampScale === sc ? "active" : ""}`}
                                            onClick={() => setStampScale(sc)}
                                        >
                                            {sc === 0.8 ? "Küçük" : sc === 1 ? "Normal" : "Büyük"}
                                        </button>
                                    ))}

                                    <span style={{ fontSize: 11, color: "rgba(255, 255, 255, 0.45)", marginLeft: 6 }}>
                                        (Tıklanan yere düz ve modern basılır)
                                    </span>
                                </div>
                            )}

                            {/* MAGIC WAND OPTIONS */}
                            {activeTool === "wand" && (
                                <div className="xen-option-group">
                                    <span className="xen-option-label">Tolerans:</span>
                                    {[15, 30, 50, 75].map(tol => (
                                        <button
                                            key={tol}
                                            className={`xen-option-btn ${wandTolerance === tol ? "active" : ""}`}
                                            onClick={() => setWandTolerance(tol)}
                                        >
                                            {tol}
                                        </button>
                                    ))}
                                    <span style={{ fontSize: 11, color: "rgba(255, 255, 255, 0.4)", marginLeft: 6 }}>
                                        (Şeffaflaştırmak istediğiniz arka plan rengine tıklayın)
                                    </span>
                                </div>
                            )}

                            {/* PIXELATE OPTIONS */}
                            {activeTool === "pixelate" && (
                                <div className="xen-option-group">
                                    <span className="xen-option-label">Piksel Sayısı:</span>
                                    <input
                                        type="range"
                                        min={1}
                                        max={10}
                                        step={1}
                                        value={pixelDensity}
                                        onChange={e => setPixelDensity(Number(e.target.value))}
                                        className="xen-slider"
                                        style={{ width: 120 }}
                                        title={`Piksel Seviyesi: ${pixelDensity}/10 (${calculateBlockSize(pixelDensity)}px)`}
                                    />
                                    <span className="xen-slider-badge">
                                        {pixelDensity === 1 ? "1 (Az)" : pixelDensity === 10 ? "10 (Çok)" : `${pixelDensity}/10`}
                                    </span>

                                    {[1, 3, 5, 8, 10].map(lvl => (
                                        <button
                                            key={lvl}
                                            className={`xen-option-btn ${pixelDensity === lvl ? "active" : ""}`}
                                            onClick={() => setPixelDensity(lvl)}
                                        >
                                            {lvl === 1 ? "Az Piksel" : lvl === 10 ? "Çok Piksel" : `Seviye ${lvl}`}
                                        </button>
                                    ))}

                                    <span style={{ fontSize: 11, color: "rgba(255, 255, 255, 0.45)", marginLeft: 6 }}>
                                        (Büyütüldükçe daha çok piksel, küçültüldükçe daha az piksel oluşur)
                                    </span>
                                </div>
                            )}

                            {/* BLUR OPTIONS */}
                            {activeTool === "blur" && (
                                <div className="xen-option-group">
                                    <span className="xen-option-label">Bulanıklık (Blur):</span>
                                    <input
                                        type="range"
                                        min={2}
                                        max={40}
                                        step={1}
                                        value={blurRadius}
                                        onChange={e => setBlurRadius(Number(e.target.value))}
                                        className="xen-slider"
                                        style={{ width: 120 }}
                                        title={`Bulanıklık: ${blurRadius}px`}
                                    />
                                    <span className="xen-slider-badge">{blurRadius}px</span>

                                    {[4, 8, 14, 22, 36].map(r => (
                                        <button
                                            key={r}
                                            className={`xen-option-btn ${blurRadius === r ? "active" : ""}`}
                                            onClick={() => setBlurRadius(r)}
                                        >
                                            {r <= 4 ? "Hafif" : r === 8 ? "Normal" : r === 14 ? "Orta" : r === 22 ? "Güçlü" : "Yoğun"} ({r}px)
                                        </button>
                                    ))}

                                    <span style={{ fontSize: 11, color: "rgba(255, 255, 255, 0.45)", marginLeft: 6 }}>
                                        (Piksel arttıkça bulanıklık yoğunlaşır)
                                    </span>
                                </div>
                            )}

                            {/* CROP OPTIONS & DISCORD PRESETS */}
                            {activeTool === "crop" && (
                                <div className="xen-option-group">
                                    <span className="xen-option-label">Oranlar:</span>
                                    <button className="xen-option-btn" onClick={() => applyCropPreset("emoji")}>
                                        128×128 (Emoji)
                                    </button>
                                    <button className="xen-option-btn" onClick={() => applyCropPreset("sticker")}>
                                        320×320 (Çıkartma)
                                    </button>
                                    <button className="xen-option-btn" onClick={() => applyCropPreset("1:1")}>
                                        1:1 Kare
                                    </button>
                                    <button className="xen-option-btn" onClick={() => applyCropPreset("16:9")}>
                                        16:9
                                    </button>
                                    <button className="xen-option-btn" onClick={() => applyCropPreset("4:3")}>
                                        4:3
                                    </button>
                                    <button className="xen-option-btn" onClick={() => applyCropPreset("9:16")}>
                                        9:16
                                    </button>

                                    {cropRect && (
                                        <>
                                            <button className="xen-option-btn active" onClick={applyCrop} style={{ marginLeft: 8 }}>
                                                Kırp ({Math.round(cropRect.w)}×{Math.round(cropRect.h)})
                                            </button>
                                            <button className="xen-option-btn" onClick={cancelCrop}>
                                                İptal
                                            </button>
                                        </>
                                    )}
                                </div>
                            )}

                            {/* TEXT OPTIONS */}
                            {activeTool === "text" && (
                                <div className="xen-option-group">
                                    <input
                                        className="xen-input-text"
                                        type="text"
                                        placeholder="Metin yazın ve resme tıklayın..."
                                        value={textInput}
                                        onChange={e => setTextInput(e.target.value)}
                                        style={{ width: 220 }}
                                    />
                                    <span className="xen-option-label">Boyut:</span>
                                    {[20, 28, 38, 52].map(sz => (
                                        <button
                                            key={sz}
                                            className={`xen-option-btn ${fontSize === sz ? "active" : ""}`}
                                            onClick={() => setFontSize(sz)}
                                        >
                                            {sz}px
                                        </button>
                                    ))}
                                </div>
                            )}

                            {/* MEME GENERATOR OPTIONS */}
                            {activeTool === "meme" && (
                                <div className="xen-option-group">
                                    <input
                                        className="xen-input-text"
                                        type="text"
                                        placeholder="Üst Yazı (Canlı)..."
                                        value={memeTop}
                                        onChange={e => setMemeTop(e.target.value)}
                                        style={{ width: 160 }}
                                    />
                                    <input
                                        className="xen-input-text"
                                        type="text"
                                        placeholder="Alt Yazı (Canlı)..."
                                        value={memeBot}
                                        onChange={e => setMemeBot(e.target.value)}
                                        style={{ width: 160 }}
                                    />
                                    <button className="xen-option-btn active" onClick={applyMeme} title="Yazıları resme kalıcı olarak uygular">
                                        Meme'i Kaydet
                                    </button>
                                    {(memeTop || memeBot) && (
                                        <button className="xen-option-btn" onClick={clearMeme} title="Yazıları sıfırlar">
                                            Temizle
                                        </button>
                                    )}
                                    <span style={{ fontSize: 11, color: "rgba(255, 255, 255, 0.8)", textShadow: "0 0 8px rgba(255, 255, 255, 0.35)", marginLeft: 6 }}>
                                        ★ Yazdıkça resmin üzerinde canlı gösterilir, üst üste binmez
                                    </span>
                                </div>
                            )}

                            {/* TRANSFORM OPTIONS */}
                            {activeTool === "transform" && (
                                <div className="xen-option-group">
                                    <button className="xen-option-btn" onClick={() => handleRotate(false)}>
                                        ⟲ 90° Sola
                                    </button>
                                    <button className="xen-option-btn" onClick={() => handleRotate(true)}>
                                        ⟳ 90° Sağa
                                    </button>
                                    <button className="xen-option-btn" onClick={() => handleFlip(true)}>
                                        ⇄ Yatay Çevir
                                    </button>
                                    <button className="xen-option-btn" onClick={() => handleFlip(false)}>
                                        ⇅ Dikey Çevir
                                    </button>
                                </div>
                            )}

                            {/* FILTER OPTIONS */}
                            {activeTool === "filter" && (
                                <div className="xen-option-group">
                                    <button className="xen-option-btn" onClick={() => applyFilter("grayscale")}>
                                        Gri Tonlama
                                    </button>
                                    <button className="xen-option-btn" onClick={() => applyFilter("invert")}>
                                        Ters Renk (Invert)
                                    </button>
                                    <button className="xen-option-btn" onClick={() => applyFilter("brightness")}>
                                        Parlat (+25%)
                                    </button>
                                    <button className="xen-option-btn" onClick={() => applyFilter("sepia")}>
                                        Nostaljik Sepya
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* CANVAS VIEWPORT / EMPTY DROPZONE */}
                    <div
                        className="xen-editor-viewport"
                        onDragOver={e => { e.preventDefault(); setIsDragActive(true); }}
                        onDragLeave={e => { e.preventDefault(); setIsDragActive(false); }}
                        onDrop={e => {
                            e.preventDefault();
                            setIsDragActive(false);
                            const file = e.dataTransfer.files?.[0];
                            if (file) handleFile(file);
                        }}
                    >
                        {/* Canvases ALWAYS mounted so refs exist when imageSource loads */}
                        <div
                            className="xen-canvas-container"
                            style={{
                                display: hasImage ? "inline-flex" : "none",
                                transform: `scale(${zoom / 100})`,
                                transformOrigin: "center center",
                                transition: "transform 0.15s ease-out"
                            }}
                        >
                            <canvas ref={mainCanvasRef} className="xen-main-canvas" />
                            <canvas
                                ref={overlayCanvasRef}
                                className="xen-overlay-canvas"
                                onMouseDown={onMouseDown}
                                onMouseMove={onMouseMove}
                                onMouseUp={onMouseUp}
                            />
                        </div>

                        {!hasImage && (
                            <div
                                className={`xen-upload-dropzone ${isDragActive ? "drag-active" : ""}`}
                                onClick={handleChooseFile}
                            >
                                <div className="xen-upload-icon">
                                    <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                                        <rect x="3" y="3" width="18" height="18" rx="4" ry="4" />
                                        <circle cx="8.5" cy="8.5" r="1.5" />
                                        <polyline points="21 15 16 10 5 21" />
                                    </svg>
                                </div>
                                <div className="xen-upload-title">Resim Düzenleyici'ye Hoş Geldiniz</div>
                                <div className="xen-upload-subtitle">
                                    Düzenlemek istediğiniz görseli buraya sürükleyip bırakın,<br />
                                    panodan yapıştırın veya bilgisayarınızdan seçin.
                                </div>
                                <div className="xen-upload-buttons" onClick={e => e.stopPropagation()}>
                                    <button className="xen-btn-primary" onClick={handleChooseFile}>
                                        Bilgisayardan Seç
                                    </button>
                                    <button
                                        className="xen-btn-secondary"
                                        onClick={handlePasteFromClipboard}
                                    >
                                        Panodan Yapıştır (Ctrl+V)
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* FOOTER */}
            <div className="xen-editor-footer">
                <div className="xen-editor-footer-left">
                    <button className="xen-btn-secondary" onClick={onClose}>
                        İptal
                    </button>

                    {/* SPOILER OPTION */}
                    <label className="xen-footer-checkbox" title="Görseli sohbete tıklandığında açılan buzlu (spoiler) olarak gönderir">
                        <input
                            type="checkbox"
                            checked={isSpoiler}
                            onChange={e => setIsSpoiler(e.target.checked)}
                        />
                        <span>Spoiler Olarak Gönder</span>
                    </label>

                    {/* REPLY TO MESSAGE OPTION */}
                    {targetMessage && (
                        <label className="xen-footer-checkbox" title="Görseli mesaja alıntı yanıtı olarak gönderir">
                            <input
                                type="checkbox"
                                checked={replyToMessage}
                                onChange={e => setReplyToMessage(e.target.checked)}
                            />
                            <span>Mesajı Yanıtla</span>
                        </label>
                    )}
                </div>

                <div className="xen-editor-footer-right">
                    {hasImage && (
                        <>
                            <button className="xen-btn-secondary" onClick={handleDownload} title="Bilgisayara PNG olarak indir">
                                İndir
                            </button>
                            <button className="xen-btn-secondary" onClick={handleCopyToClipboard} title="Panoya PNG kopyala">
                                Panoya Kopyala
                            </button>

                            {/* RECIPIENT POPOUT SELECTOR */}
                            <div className="xen-recipient-wrapper" ref={recipientRef}>
                                <button
                                    className="xen-recipient-btn"
                                    onClick={() => {
                                        commitPendingChanges();
                                        setIsRecipientOpen(!isRecipientOpen);
                                    }}
                                    title="Görselin gönderileceği kullanıcıyı veya kanalı seçin"
                                >
                                    <span>Alıcı:</span>
                                    <span style={{ color: "#FFFFFF" }}>
                                        {selectedRecipient ? `@${selectedRecipient.globalName || selectedRecipient.username}` : "Mevcut Sohbet"}
                                    </span>
                                    <span style={{ fontSize: 10, opacity: 0.6 }}>▾</span>
                                </button>

                                {isRecipientOpen && (
                                    <div className="xen-recipient-popout">
                                        <div className="xen-recipient-header">
                                            <input
                                                className="xen-recipient-search"
                                                type="text"
                                                placeholder="Kullanıcı veya arkadaş ara..."
                                                value={searchQuery}
                                                onChange={e => setSearchQuery(e.target.value)}
                                                autoFocus
                                            />
                                        </div>
                                        <div className="xen-recipient-list">
                                            <div
                                                className={`xen-recipient-item ${!selectedRecipient ? "active" : ""}`}
                                                onClick={() => {
                                                    commitPendingChanges();
                                                    setSelectedRecipient(null);
                                                    setIsRecipientOpen(false);
                                                }}
                                            >
                                                <div style={{ width: 28, height: 28, borderRadius: "50%", background: "rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>
                                                    💬
                                                </div>
                                                <div className="xen-recipient-info">
                                                    <span className="xen-recipient-name">Mevcut Sohbet</span>
                                                    <span className="xen-recipient-username">Aktif kanala yükler</span>
                                                </div>
                                                {!selectedRecipient && <span style={{ color: "#FFFFFF", fontSize: 12 }}>✓</span>}
                                            </div>

                                            {filteredUsers.length > 0 && (
                                                <>
                                                    <div className="xen-recipient-section-title">Arkadaşlar & Son Sohbetler</div>
                                                    {filteredUsers.map(user => {
                                                        const avatarUrl = user.getAvatarURL?.(undefined, 32) ?? IconUtils?.getUserAvatarURL?.(user);
                                                        const isSel = selectedRecipient?.id === user.id;
                                                        return (
                                                            <div
                                                                key={user.id}
                                                                className={`xen-recipient-item ${isSel ? "active" : ""}`}
                                                                onClick={() => {
                                                                    commitPendingChanges();
                                                                    setSelectedRecipient(user);
                                                                    setIsRecipientOpen(false);
                                                                }}
                                                            >
                                                                {avatarUrl ? (
                                                                    <img className="xen-recipient-avatar" src={avatarUrl} alt="" />
                                                                ) : (
                                                                    <div className="xen-recipient-avatar" style={{ display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 }}>
                                                                        {user.username?.[0]?.toUpperCase() ?? "U"}
                                                                    </div>
                                                                )}
                                                                <div className="xen-recipient-info">
                                                                    <span className="xen-recipient-name">
                                                                        {user.globalName || user.username}
                                                                    </span>
                                                                    <span className="xen-recipient-username">
                                                                        @{user.username}
                                                                    </span>
                                                                </div>
                                                                {isSel && <span style={{ color: "#FFFFFF", fontSize: 12 }}>✓</span>}
                                                            </div>
                                                        );
                                                    })}
                                                </>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>

                            <button
                                className="xen-btn-primary"
                                onClick={handleSend}
                                title="Görseli seçilen kullanıcıya veya kanala gönder"
                            >
                                {selectedRecipient ? `@${selectedRecipient.globalName || selectedRecipient.username}'e Gönder` : "Sohbete Gönder"}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
