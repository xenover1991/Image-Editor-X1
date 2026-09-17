/*
 * ImageEditor - Developed by xen (206993987125510144)
 * Pure HTML5 Canvas 2D Engine
 */

export interface Point {
    x: number;
    y: number;
}

export function wrapTextLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
    if (!text) return [];
    const lines: string[] = [];
    const paragraphs = text.split("\n");
    for (const para of paragraphs) {
        const words = para.trim().split(/\s+/);
        if (words.length === 0 || (words.length === 1 && words[0] === "")) {
            lines.push("");
            continue;
        }
        let currentLine = words[0];
        for (let i = 1; i < words.length; i++) {
            const word = words[i];
            const testLine = `${currentLine} ${word}`;
            const metrics = ctx.measureText(testLine);
            if (metrics.width > maxWidth) {
                lines.push(currentLine);
                currentLine = word;
            } else {
                currentLine = testLine;
            }
        }
        lines.push(currentLine);
    }
    return lines;
}

export class CanvasEngine {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private history: ImageData[] = [];
    private historyIndex = -1;
    private maxHistory = 25;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("2D Canvas Context oluşturulamadı.");
        this.ctx = ctx;
    }

    public initFromImage(img: HTMLImageElement, width?: number, height?: number) {
        const w = width ?? img.naturalWidth ?? img.width;
        const h = height ?? img.naturalHeight ?? img.height;
        this.canvas.width = w;
        this.canvas.height = h;

        this.ctx.clearRect(0, 0, w, h);
        this.ctx.drawImage(img, 0, 0, w, h);

        this.history = [];
        this.historyIndex = -1;
        this.pushState();
    }

    public pushState() {
        const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        // Truncate redo states
        if (this.historyIndex < this.history.length - 1) {
            this.history = this.history.slice(0, this.historyIndex + 1);
        }
        this.history.push(imageData);
        if (this.history.length > this.maxHistory) {
            this.history.shift();
        } else {
            this.historyIndex++;
        }
    }

    public canUndo(): boolean {
        return this.historyIndex > 0;
    }

    public canRedo(): boolean {
        return this.historyIndex < this.history.length - 1;
    }

    public undo(): boolean {
        if (!this.canUndo()) return false;
        this.historyIndex--;
        const state = this.history[this.historyIndex];
        this.restoreState(state);
        return true;
    }

    public redo(): boolean {
        if (!this.canRedo()) return false;
        this.historyIndex++;
        const state = this.history[this.historyIndex];
        this.restoreState(state);
        return true;
    }

    private restoreState(state: ImageData) {
        if (this.canvas.width !== state.width || this.canvas.height !== state.height) {
            this.canvas.width = state.width;
            this.canvas.height = state.height;
        }
        this.ctx.putImageData(state, 0, 0);
    }

    public getWidth(): number {
        return this.canvas.width;
    }

    public getHeight(): number {
        return this.canvas.height;
    }

    public getContext(): CanvasRenderingContext2D {
        return this.ctx;
    }

    public getCanvas(): HTMLCanvasElement {
        return this.canvas;
    }

    public getCurrentState(): ImageData {
        return this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    }

    // --- CENSOR / PIXELATE ---
    public applyPixelate(rectX: number, rectY: number, rectW: number, rectH: number, blockSize = 14) {
        const x = Math.max(0, Math.min(Math.round(rectX), this.canvas.width));
        const y = Math.max(0, Math.min(Math.round(rectY), this.canvas.height));
        const w = Math.min(Math.round(rectW), this.canvas.width - x);
        const h = Math.min(Math.round(rectH), this.canvas.height - y);

        if (w <= 1 || h <= 1) return;

        const effectiveBlockSize = Math.max(4, blockSize);
        const scaledW = Math.max(1, Math.round(w / effectiveBlockSize));
        const scaledH = Math.max(1, Math.round(h / effectiveBlockSize));

        // Offscreen small canvas for downsampling
        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = scaledW;
        tempCanvas.height = scaledH;
        const tempCtx = tempCanvas.getContext("2d");
        if (!tempCtx) return;

        // Draw downsampled region
        tempCtx.drawImage(this.canvas, x, y, w, h, 0, 0, scaledW, scaledH);

        // Draw back to main canvas upscaled without smoothing (creates sharp crisp pixel blocks)
        this.ctx.save();
        this.ctx.imageSmoothingEnabled = false;
        (this.ctx as any).mozImageSmoothingEnabled = false;
        (this.ctx as any).webkitImageSmoothingEnabled = false;
        (this.ctx as any).msImageSmoothingEnabled = false;

        this.ctx.drawImage(tempCanvas, 0, 0, scaledW, scaledH, x, y, w, h);
        this.ctx.restore();

        this.pushState();
    }

    // --- CENSOR / BLUR ---
    public applyBlur(rectX: number, rectY: number, rectW: number, rectH: number, radius = 12) {
        const x = Math.max(0, Math.min(Math.round(rectX), this.canvas.width));
        const y = Math.max(0, Math.min(Math.round(rectY), this.canvas.height));
        const w = Math.min(Math.round(rectW), this.canvas.width - x);
        const h = Math.min(Math.round(rectH), this.canvas.height - y);

        if (w <= 1 || h <= 1) return;

        // Clone current canvas snapshot to avoid self-drawing buffer conflicts
        const snapshot = document.createElement("canvas");
        snapshot.width = this.canvas.width;
        snapshot.height = this.canvas.height;
        const snapCtx = snapshot.getContext("2d");
        if (!snapCtx) return;
        snapCtx.drawImage(this.canvas, 0, 0);

        // Clip to the selected region and draw blurred snapshot
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.rect(x, y, w, h);
        this.ctx.clip();
        this.ctx.filter = `blur(${Math.max(2, radius)}px)`;
        this.ctx.drawImage(snapshot, 0, 0);
        this.ctx.restore();

        this.pushState();
    }

    // --- CENSOR / REDACT (BLACKOUT) ---
    public applyRedact(rectX: number, rectY: number, rectW: number, rectH: number, color = "#000000") {
        const x = Math.max(0, Math.min(Math.round(rectX), this.canvas.width));
        const y = Math.max(0, Math.min(Math.round(rectY), this.canvas.height));
        const w = Math.min(Math.round(rectW), this.canvas.width - x);
        const h = Math.min(Math.round(rectH), this.canvas.height - y);

        if (w <= 1 || h <= 1) return;

        this.ctx.save();
        this.ctx.fillStyle = color;
        this.ctx.fillRect(x, y, w, h);
        this.ctx.restore();
        this.pushState();
    }

    // --- DRAWING: BRUSH / PATH ---
    public drawFreehand(points: Point[], color: string, width: number, isHighlighter = false) {
        if (points.length < 2) return;
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.lineCap = "round";
        this.ctx.lineJoin = "round";

        if (isHighlighter) {
            this.ctx.strokeStyle = color;
            this.ctx.globalAlpha = 0.35;
            this.ctx.lineWidth = width * 2.5;
        } else {
            this.ctx.strokeStyle = color;
            this.ctx.globalAlpha = 1.0;
            this.ctx.lineWidth = width;
        }

        this.ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
            this.ctx.lineTo(points[i].x, points[i].y);
        }
        this.ctx.stroke();
        this.ctx.restore();
        this.pushState();
    }

    // --- DRAWING: ARROW ---
    public drawArrow(
        fromX: number,
        fromY: number,
        toX: number,
        toY: number,
        color: string,
        width: number,
        targetCtx?: CanvasRenderingContext2D
    ) {
        const dx = toX - fromX;
        const dy = toY - fromY;
        const length = Math.hypot(dx, dy);
        if (length < 3) return;

        const angle = Math.atan2(dy, dx);
        const headLength = Math.max(15, Math.min(width * 3.6 + 6, length * 0.55));
        const spread = Math.PI / 7.2; // ~25 degrees - sleek aerodynamic
        const notchDepth = headLength * 0.22;

        const leftX = toX - headLength * Math.cos(angle - spread);
        const leftY = toY - headLength * Math.sin(angle - spread);
        const rightX = toX - headLength * Math.cos(angle + spread);
        const rightY = toY - headLength * Math.sin(angle + spread);
        const notchX = toX - (headLength - notchDepth) * Math.cos(angle);
        const notchY = toY - (headLength - notchDepth) * Math.sin(angle);

        // Shaft ends right where the arrowhead notch begins (slightly overlapping into head so no seam)
        const shaftEndX = toX - (headLength - notchDepth * 0.7) * Math.cos(angle);
        const shaftEndY = toY - (headLength - notchDepth * 0.7) * Math.sin(angle);

        const ctx = targetCtx ?? this.ctx;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        // 1. Shaft line (starts with smooth round cap, stops seamlessly inside the arrowhead base)
        ctx.beginPath();
        ctx.moveTo(fromX, fromY);
        ctx.lineTo(shaftEndX, shaftEndY);
        ctx.lineWidth = width;
        ctx.stroke();

        // 2. Modern aerodynamic arrowhead (swept back wings, razor sharp tip)
        ctx.beginPath();
        ctx.moveTo(toX, toY);
        ctx.lineTo(leftX, leftY);
        ctx.lineTo(notchX, notchY);
        ctx.lineTo(rightX, rightY);
        ctx.closePath();
        ctx.fill();

        // Subtle stroke around arrowhead to smooth vertices with round join
        ctx.lineWidth = Math.min(2, width * 0.25);
        ctx.stroke();

        ctx.restore();

        if (!targetCtx) {
            this.pushState();
        }
    }

    // --- DRAWING: SHAPES ---
    public drawRectangle(x: number, y: number, w: number, h: number, color: string, lineWidth: number, filled = false) {
        this.ctx.save();
        this.ctx.strokeStyle = color;
        this.ctx.fillStyle = color;
        this.ctx.lineWidth = lineWidth;
        this.ctx.lineJoin = "round";

        if (filled) {
            this.ctx.fillRect(x, y, w, h);
        } else {
            this.ctx.strokeRect(x, y, w, h);
        }

        this.ctx.restore();
        this.pushState();
    }

    public drawEllipse(centerX: number, centerY: number, radiusX: number, radiusY: number, color: string, lineWidth: number, filled = false) {
        this.ctx.save();
        this.ctx.strokeStyle = color;
        this.ctx.fillStyle = color;
        this.ctx.lineWidth = lineWidth;

        this.ctx.beginPath();
        this.ctx.ellipse(centerX, centerY, Math.abs(radiusX), Math.abs(radiusY), 0, 0, Math.PI * 2);

        if (filled) {
            this.ctx.fill();
        } else {
            this.ctx.stroke();
        }

        this.ctx.restore();
        this.pushState();
    }

    // --- TEXT & MEME ---
    public drawText(text: string, x: number, y: number, fontSize: number, color: string, hasBg = false, bgColor = "rgba(0, 0, 0, 0.75)") {
        if (!text.trim()) return;
        this.ctx.save();
        this.ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "SF Pro", sans-serif`;
        this.ctx.textBaseline = "top";

        const lines = text.split("\n");
        const lineHeight = fontSize * 1.3;
        let maxWidth = 0;
        for (const line of lines) {
            const m = this.ctx.measureText(line);
            if (m.width > maxWidth) maxWidth = m.width;
        }

        const totalH = lines.length * lineHeight;
        const pad = fontSize * 0.4;

        if (hasBg) {
            this.ctx.fillStyle = bgColor;
            this.ctx.beginPath();
            const rx = x - pad;
            const ry = y - pad;
            const rw = maxWidth + pad * 2;
            const rh = totalH + pad * 1.2;
            const r = 8;
            this.ctx.roundRect(rx, ry, rw, rh, r);
            this.ctx.fill();
        }

        // Apple style subtle ambient glow
        this.ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
        this.ctx.shadowBlur = 6;
        this.ctx.shadowOffsetY = 2;

        this.ctx.fillStyle = color;
        for (let i = 0; i < lines.length; i++) {
            this.ctx.fillText(lines[i], x, y + i * lineHeight);
        }

        this.ctx.restore();
        this.pushState();
    }

    public drawMeme(
        topText: string,
        bottomText: string,
        targetCtx: CanvasRenderingContext2D = this.ctx,
        isCommit = true
    ) {
        const w = this.canvas.width;
        const h = this.canvas.height;
        if (w <= 0 || h <= 0) return;

        // Proportional font sizing for crisp visibility on any resolution
        const effectiveFontSize = Math.max(22, Math.min(Math.round(w / 13), Math.round(h / 9), 68));
        const lineHeight = effectiveFontSize * 1.15;
        const marginY = Math.max(16, Math.round(h * 0.035));
        const maxWidth = w * 0.92;
        const strokeWidth = Math.max(3.5, effectiveFontSize / 7);

        targetCtx.save();
        targetCtx.font = `900 ${effectiveFontSize}px Impact, -apple-system, BlinkMacSystemFont, "SF Pro Display", "Arial Black", sans-serif`;
        targetCtx.textAlign = "center";
        targetCtx.fillStyle = "#FFFFFF";
        targetCtx.strokeStyle = "#000000";
        targetCtx.lineWidth = strokeWidth;
        targetCtx.lineJoin = "round";
        targetCtx.miterLimit = 2;

        // Subtle ambient shadow for high contrast
        targetCtx.shadowColor = "rgba(0, 0, 0, 0.7)";
        targetCtx.shadowBlur = 10;
        targetCtx.shadowOffsetY = 3;

        const cx = w / 2;

        // Top text rendering with multi-line auto-wrap
        if (topText.trim()) {
            targetCtx.textBaseline = "top";
            const upperTop = topText.toUpperCase();
            const lines = wrapTextLines(targetCtx, upperTop, maxWidth);
            for (let i = 0; i < lines.length; i++) {
                const y = marginY + i * lineHeight;
                targetCtx.strokeText(lines[i], cx, y);
                targetCtx.fillText(lines[i], cx, y);
            }
        }

        // Bottom text rendering with multi-line auto-wrap
        if (bottomText.trim()) {
            targetCtx.textBaseline = "bottom";
            const upperBot = bottomText.toUpperCase();
            const lines = wrapTextLines(targetCtx, upperBot, maxWidth);
            for (let i = 0; i < lines.length; i++) {
                const lineIdxFromEnd = lines.length - 1 - i;
                const y = h - marginY - (lineIdxFromEnd * lineHeight);
                targetCtx.strokeText(lines[i], cx, y);
                targetCtx.fillText(lines[i], cx, y);
            }
        }

        targetCtx.restore();
        if (isCommit) {
            this.pushState();
        }
    }

    // --- TRANSFORMATIONS ---
    public rotate(clockwise = true) {
        const prevW = this.canvas.width;
        const prevH = this.canvas.height;

        const offscreen = document.createElement("canvas");
        offscreen.width = prevW;
        offscreen.height = prevH;
        const offCtx = offscreen.getContext("2d");
        if (!offCtx) return;
        offCtx.drawImage(this.canvas, 0, 0);

        this.canvas.width = prevH;
        this.canvas.height = prevW;

        this.ctx.save();
        if (clockwise) {
            this.ctx.translate(prevH, 0);
            this.ctx.rotate(Math.PI / 2);
        } else {
            this.ctx.translate(0, prevW);
            this.ctx.rotate(-Math.PI / 2);
        }
        this.ctx.drawImage(offscreen, 0, 0);
        this.ctx.restore();

        this.pushState();
    }

    public flip(horizontal = true) {
        const offscreen = document.createElement("canvas");
        offscreen.width = this.canvas.width;
        offscreen.height = this.canvas.height;
        const offCtx = offscreen.getContext("2d");
        if (!offCtx) return;
        offCtx.drawImage(this.canvas, 0, 0);

        this.ctx.save();
        if (horizontal) {
            this.ctx.translate(this.canvas.width, 0);
            this.ctx.scale(-1, 1);
        } else {
            this.ctx.translate(0, this.canvas.height);
            this.ctx.scale(1, -1);
        }
        this.ctx.drawImage(offscreen, 0, 0);
        this.ctx.restore();

        this.pushState();
    }

    public crop(x: number, y: number, w: number, h: number) {
        const actualX = Math.max(0, Math.round(x));
        const actualY = Math.max(0, Math.round(y));
        const actualW = Math.min(Math.round(w), this.canvas.width - actualX);
        const actualH = Math.min(Math.round(h), this.canvas.height - actualY);

        if (actualW <= 4 || actualH <= 4) return;

        const croppedData = this.ctx.getImageData(actualX, actualY, actualW, actualH);
        this.canvas.width = actualW;
        this.canvas.height = actualH;
        this.ctx.putImageData(croppedData, 0, 0);

        this.pushState();
    }

    // --- FILTERS ---
    public applyFilters(options: { brightness?: number; contrast?: number; grayscale?: boolean; invert?: boolean; sepia?: boolean }) {
        const filters: string[] = [];
        if (options.brightness !== undefined) filters.push(`brightness(${options.brightness}%)`);
        if (options.contrast !== undefined) filters.push(`contrast(${options.contrast}%)`);
        if (options.grayscale) filters.push("grayscale(100%)");
        if (options.invert) filters.push("invert(100%)");
        if (options.sepia) filters.push("sepia(100%)");

        if (filters.length === 0) return;

        const offscreen = document.createElement("canvas");
        offscreen.width = this.canvas.width;
        offscreen.height = this.canvas.height;
        const offCtx = offscreen.getContext("2d");
        if (!offCtx) return;

        offCtx.drawImage(this.canvas, 0, 0);

        this.ctx.save();
        this.ctx.filter = filters.join(" ");
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.drawImage(offscreen, 0, 0);
        this.ctx.restore();

        this.pushState();
    }

    // --- SPOTLIGHT / ODAK IŞIĞI ---
    public applySpotlight(rectX: number, rectY: number, rectW: number, rectH: number, isCircle = false) {
        const x = Math.max(0, Math.min(Math.round(rectX), this.canvas.width));
        const y = Math.max(0, Math.min(Math.round(rectY), this.canvas.height));
        const w = Math.min(Math.round(rectW), this.canvas.width - x);
        const h = Math.min(Math.round(rectH), this.canvas.height - y);

        if (w <= 4 || h <= 4) return;

        const snapshot = document.createElement("canvas");
        snapshot.width = this.canvas.width;
        snapshot.height = this.canvas.height;
        const snapCtx = snapshot.getContext("2d");
        if (!snapCtx) return;
        snapCtx.drawImage(this.canvas, 0, 0);

        this.ctx.save();
        // Rich dark cinematic spotlight backdrop
        this.ctx.fillStyle = "rgba(0, 0, 0, 0.78)";
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Punch out illuminated spotlight area
        this.ctx.globalCompositeOperation = "destination-out";
        this.ctx.beginPath();
        if (isCircle) {
            this.ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        } else {
            this.ctx.roundRect(x, y, w, h, 12);
        }
        this.ctx.fill();

        // Draw original image underneath
        this.ctx.globalCompositeOperation = "destination-over";
        this.ctx.drawImage(snapshot, 0, 0);

        // Glowing border outline
        this.ctx.globalCompositeOperation = "source-over";
        this.ctx.shadowColor = "rgba(255, 255, 255, 0.9)";
        this.ctx.shadowBlur = 16;
        this.ctx.strokeStyle = "#FFFFFF";
        this.ctx.lineWidth = 2.5;
        this.ctx.stroke();

        this.ctx.restore();
        this.pushState();
    }

    // --- MAGNIFIER / BÜYÜTEÇ ---
    public applyMagnifier(centerX: number, centerY: number, radius = 70, zoomLevel = 2) {
        const cx = Math.round(centerX);
        const cy = Math.round(centerY);
        const r = Math.max(20, Math.round(radius));

        const snapshot = document.createElement("canvas");
        snapshot.width = this.canvas.width;
        snapshot.height = this.canvas.height;
        const snapCtx = snapshot.getContext("2d");
        if (!snapCtx) return;
        snapCtx.drawImage(this.canvas, 0, 0);

        this.ctx.save();

        this.ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
        this.ctx.shadowBlur = 18;
        this.ctx.shadowOffsetY = 4;

        this.ctx.beginPath();
        this.ctx.arc(cx, cy, r, 0, Math.PI * 2);
        this.ctx.clip();

        this.ctx.translate(cx, cy);
        this.ctx.scale(zoomLevel, zoomLevel);
        this.ctx.translate(-cx, -cy);
        this.ctx.drawImage(snapshot, 0, 0);

        this.ctx.restore();

        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, r, 0, Math.PI * 2);
        this.ctx.strokeStyle = "#FFFFFF";
        this.ctx.lineWidth = 3.5;
        this.ctx.stroke();

        this.ctx.beginPath();
        this.ctx.arc(cx, cy, r - 3.5, 0, Math.PI * 2);
        this.ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
        this.ctx.lineWidth = 1;
        this.ctx.stroke();
        this.ctx.restore();

        this.pushState();
    }

    // --- NUMBERED STEP BADGE ---
    public drawStepBadge(x: number, y: number, stepNumber: number, color = "#FF3B30", radius = 18) {
        this.ctx.save();
        this.ctx.shadowColor = color;
        this.ctx.shadowBlur = 12;
        this.ctx.shadowOffsetY = 2;

        this.ctx.beginPath();
        this.ctx.arc(x, y, radius, 0, Math.PI * 2);
        this.ctx.fillStyle = color;
        this.ctx.fill();

        this.ctx.lineWidth = 2.5;
        this.ctx.strokeStyle = "#FFFFFF";
        this.ctx.stroke();

        this.ctx.shadowColor = "transparent";
        this.ctx.font = `800 ${Math.round(radius * 1.15)}px -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro", sans-serif`;
        this.ctx.textAlign = "center";
        this.ctx.textBaseline = "middle";
        this.ctx.fillStyle = "#FFFFFF";
        this.ctx.fillText(String(stepNumber), x, y + 1);

        this.ctx.restore();
        this.pushState();
    }

    // --- SPEECH BUBBLE ---
    public drawSpeechBubble(
        x: number, y: number, w: number, h: number,
        tailX: number, tailY: number,
        text: string, bgColor = "#007AFF", textColor = "#FFFFFF", fontSize = 16,
        targetCtx: CanvasRenderingContext2D = this.ctx, isCommit = true
    ) {
        targetCtx.save();

        targetCtx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", sans-serif`;

        const maxTextW = Math.max(90, w - 28);
        const lines = wrapTextLines(targetCtx, text || "Mesaj", maxTextW);
        const lineHeight = fontSize * 1.35;
        const requiredTextH = lines.length * lineHeight;

        const actualW = Math.max(w, 110);
        const actualH = Math.max(h, requiredTextH + 24);
        const r = Math.min(18, actualH / 2);

        // Seamless speech tail geometry pointing to target
        const tailBaseW = 16;
        const tailBaseX = Math.max(x + r + 4, Math.min(x + actualW - r - 4 - tailBaseW, x + 20));
        const targetTailX = tailX !== undefined && Math.abs(tailX - (x + actualW / 2)) > 5 ? tailX : tailBaseX - 8;
        const targetTailY = tailY !== undefined && tailY > y + actualH ? tailY : y + actualH + 20;

        // Glowing drop shadow
        targetCtx.shadowColor = "rgba(0, 0, 0, 0.45)";
        targetCtx.shadowBlur = 14;
        targetCtx.shadowOffsetY = 4;

        // Single unified closed contour
        targetCtx.beginPath();
        targetCtx.moveTo(x + r, y);
        targetCtx.lineTo(x + actualW - r, y);
        targetCtx.arcTo(x + actualW, y, x + actualW, y + r, r);
        targetCtx.lineTo(x + actualW, y + actualH - r);
        targetCtx.arcTo(x + actualW, y + actualH, x + actualW - r, y + actualH, r);

        // Bottom edge and integrated tail
        targetCtx.lineTo(tailBaseX + tailBaseW, y + actualH);
        targetCtx.lineTo(targetTailX, targetTailY);
        targetCtx.lineTo(tailBaseX, y + actualH);

        targetCtx.lineTo(x + r, y + actualH);
        targetCtx.arcTo(x, y + actualH, x, y + actualH - r, r);
        targetCtx.lineTo(x, y + r);
        targetCtx.arcTo(x, y, x + r, y, r);
        targetCtx.closePath();

        targetCtx.fillStyle = bgColor;
        targetCtx.fill();

        // Glowing border stroke
        targetCtx.strokeStyle = "rgba(255, 255, 255, 0.45)";
        targetCtx.lineWidth = 1.5;
        targetCtx.stroke();

        // Render inner text with high contrast and text glow
        targetCtx.shadowColor = "rgba(0, 0, 0, 0.5)";
        targetCtx.shadowBlur = 4;
        targetCtx.shadowOffsetY = 1;
        targetCtx.fillStyle = textColor;
        targetCtx.textAlign = "center";
        targetCtx.textBaseline = "middle";

        const textCenterY = y + actualH / 2;
        const startY = textCenterY - ((lines.length - 1) * lineHeight) / 2;
        for (let i = 0; i < lines.length; i++) {
            targetCtx.fillText(lines[i], x + actualW / 2, startY + i * lineHeight);
        }

        targetCtx.restore();
        if (isCommit) {
            this.pushState();
        }
    }

    // --- STAMPS (APPROVED, REJECTED, BUG, CONFIDENTIAL, VERIFIED) ---
    public drawStamp(
        type: "approved" | "rejected" | "bug" | "confidential" | "verified",
        x: number,
        y: number,
        scale = 1
    ) {
        this.ctx.save();
        this.ctx.translate(x, y);
        // Straight, zero rotation (no tilt)

        let label = "ONAYLANDI";
        let color = "#30D158"; // Apple Emerald
        let icon = "✓";

        if (type === "rejected") {
            label = "REDDEDİLDİ";
            color = "#FF453A"; // Apple Coral Red
            icon = "✕";
        } else if (type === "bug") {
            label = "HATA";
            color = "#FF9F0A"; // Apple Amber
            icon = "⚡";
        } else if (type === "confidential") {
            label = "GİZLİ";
            color = "#BF5AF2"; // Apple Purple
            icon = "🔒";
        } else if (type === "verified") {
            label = "DOĞRULANDI";
            color = "#0A84FF"; // Apple Blue
            icon = "✓";
        }

        this.ctx.font = `800 ${14 * scale}px -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro", sans-serif`;
        const fullText = `${icon}  ${label}`;
        const textMetrics = this.ctx.measureText(fullText);
        const padX = 20 * scale;
        const stampW = textMetrics.width + padX * 2;
        const stampH = 38 * scale;
        const radius = 10 * scale;

        // Dark translucent glass background
        this.ctx.beginPath();
        this.ctx.roundRect(-stampW / 2, -stampH / 2, stampW, stampH, radius);
        this.ctx.fillStyle = "rgba(18, 20, 26, 0.92)";
        this.ctx.fill();

        // Glowing colored neon border
        this.ctx.shadowColor = color;
        this.ctx.shadowBlur = 14 * scale;
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 2.5 * scale;
        this.ctx.stroke();

        // Inner subtle border line
        this.ctx.beginPath();
        this.ctx.roundRect(-stampW / 2 + 3 * scale, -stampH / 2 + 3 * scale, stampW - 6 * scale, stampH - 6 * scale, radius - 2 * scale);
        this.ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
        this.ctx.lineWidth = 1 * scale;
        this.ctx.stroke();

        // Glowing vibrant text
        this.ctx.shadowColor = color;
        this.ctx.shadowBlur = 8 * scale;
        this.ctx.fillStyle = color;
        this.ctx.textAlign = "center";
        this.ctx.textBaseline = "middle";
        this.ctx.fillText(fullText, 0, 1 * scale);

        this.ctx.restore();
        this.pushState();
    }

    // --- WATERMARK / FİLİGRAN ---
    public drawWatermark(text = "developed by xen", position: "bottom-right" | "bottom-left" = "bottom-right") {
        this.ctx.save();
        const fontSize = Math.max(12, Math.round(this.canvas.width * 0.016));
        this.ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro", sans-serif`;
        const padX = 14;
        const padY = 6;
        const textW = this.ctx.measureText(text).width;
        const badgeW = textW + padX * 2;
        const badgeH = fontSize + padY * 2;

        let bx = this.canvas.width - badgeW - 16;
        const by = this.canvas.height - badgeH - 16;
        if (position === "bottom-left") bx = 16;

        this.ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
        this.ctx.beginPath();
        this.ctx.roundRect(bx, by, badgeW, badgeH, 6);
        this.ctx.fill();

        this.ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
        this.ctx.lineWidth = 1;
        this.ctx.stroke();

        this.ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
        this.ctx.textAlign = "center";
        this.ctx.textBaseline = "middle";
        this.ctx.fillText(text, bx + badgeW / 2, by + badgeH / 2);

        this.ctx.restore();
        this.pushState();
    }

    // --- TRANSPARENT CUTOUT / COLOR KEYING ---
    public removeBackgroundColor(targetX: number, targetY: number, tolerance = 30) {
        const x = Math.max(0, Math.min(Math.round(targetX), this.canvas.width - 1));
        const y = Math.max(0, Math.min(Math.round(targetY), this.canvas.height - 1));

        const imgData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        const data = imgData.data;

        const targetIdx = (y * this.canvas.width + x) * 4;
        const tr = data[targetIdx];
        const tg = data[targetIdx + 1];
        const tb = data[targetIdx + 2];

        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const dist = Math.sqrt((r - tr) ** 2 + (g - tg) ** 2 + (b - tb) ** 2);
            if (dist <= tolerance) {
                data[i + 3] = 0; // Alpha transparent
            }
        }

        this.ctx.putImageData(imgData, 0, 0);
        this.pushState();
    }

    // --- EXPORT ---
    public toBlob(type = "image/png", quality = 0.95): Promise<Blob> {
        return new Promise((resolve, reject) => {
            this.canvas.toBlob(
                blob => {
                    if (blob) resolve(blob);
                    else reject(new Error("Canvas toBlob başarısız oldu."));
                },
                type,
                quality
            );
        });
    }

    public toFile(filename = "image_edited_xen.png"): Promise<File> {
        return this.toBlob().then(blob => new File([blob], filename, { type: "image/png" }));
    }
}
