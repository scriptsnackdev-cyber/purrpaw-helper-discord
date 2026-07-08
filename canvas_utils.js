const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');
const fs = require('fs');

// 🎨 Font stack config (Thai & Emoji fallback support)
const fontStack = '"Leelawadee UI", "Quivira", "NotoSymbols", "NotoEmoji", "Segoe UI Symbol", "Segoe UI Emoji", "Arial Unicode MS", sans-serif';
const fontStackBold = '"Leelawadee UI", "Quivira", "NotoSymbolsBold", "NotoEmoji", "Segoe UI Symbol", "Segoe UI Emoji", "Arial Unicode MS", sans-serif';

/**
 * Registers all custom fonts from the local assets folder
 */
function registerSystemFonts() {
    try {
        const fontsPath = path.join(__dirname, 'assets/fonts');
        
        GlobalFonts.registerFromPath(path.join(fontsPath, 'Quivira/Quivira.otf'), 'Quivira');
        GlobalFonts.registerFromPath(path.join(fontsPath, 'Noto_Color_Emoji,Noto_Sans_Symbols/Noto_Color_Emoji/NotoColorEmoji-Regular.ttf'), 'NotoEmoji');
        GlobalFonts.registerFromPath(path.join(fontsPath, 'Noto_Sans_Symbols/static/NotoSansSymbols-Bold.ttf'), 'NotoSymbolsBold');
        GlobalFonts.registerFromPath(path.join(fontsPath, 'Noto_Sans_Symbols/static/NotoSansSymbols-Regular.ttf'), 'NotoSymbols');
        
        console.log('✅ [Fonts] Registered custom fonts successfully.');
    } catch (e) {
        console.error('❌ [Fonts] Font registration failed:', e);
    }
}

/**
 * Draws an image on canvas with "object-fit: cover" behavior
 */
function drawImageCover(ctx, image, x, y, w, h) {
    const imgRatio = image.width / image.height;
    const canvasRatio = w / h;
    let sx, sy, sw, sh;

    if (imgRatio > canvasRatio) {
        sh = image.height;
        sw = image.height * canvasRatio;
        sx = (image.width - sw) / 2;
        sy = 0;
    } else {
        sw = image.width;
        sh = image.width / canvasRatio;
        sx = 0;
        sy = (image.height - sh) / 2;
    }

    ctx.drawImage(image, sx, sy, sw, sh, x, y, w, h);
}

/**
 * Loads and draws the background
 */
async function drawBackground(ctx, width, height, customURL = null) {
    try {
        if (customURL) {
            const background = await loadImage(customURL);
            drawImageCover(ctx, background, 0, 0, width, height);
            return true;
        }
    } catch (error) {
        console.error('Failed to load custom background:', error);
    }

    const defaultBgPath = path.join(__dirname, 'assets/rank_bg.png');
    if (fs.existsSync(defaultBgPath)) {
        try {
            const background = await loadImage(defaultBgPath);
            drawImageCover(ctx, background, 0, 0, width, height);
            return true;
        } catch (error) {
            console.error('Failed to load default background:', error);
        }
    }

    // Final Fallback: Gradient
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#2c2f33');
    gradient.addColorStop(1, '#23272a');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    return false;
}

/**
 * Helper to draw a rounded rectangle
 */
function drawRoundedRect(ctx, x, y, w, h, r) {
    if (w < 2 * r) r = w / 2;
    if (h < 2 * r) r = h / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
}

/**
 * Generates a Level Up image card
 */
async function generateLevelUpCard(user, level, roleName = null, displayName = null, avatarURL = null, customBackgroundURL = null) {
    const canvas = createCanvas(984, 282);
    const ctx = canvas.getContext('2d');

    // 1. Load Background
    await drawBackground(ctx, canvas.width, canvas.height, customBackgroundURL);

    // 2. Overlay
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    drawRoundedRect(ctx, 20, 20, 944, 242, 20);

    // 3. Avatar
    const avatarSize = 160;
    const avatarX = 50;
    const avatarY = (canvas.height - avatarSize) / 2;
    
    // Avatar Shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 15;
    ctx.beginPath();
    ctx.arc(avatarX + avatarSize/2, avatarY + avatarSize/2, avatarSize/2 + 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarX + avatarSize/2, avatarY + avatarSize/2, avatarSize/2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    
    const finalAvatarURL = avatarURL || user.displayAvatarURL({ extension: 'png', size: 256 });
    const avatarImg = await loadImage(finalAvatarURL);
    ctx.drawImage(avatarImg, avatarX, avatarY, avatarSize, avatarSize);
    ctx.restore();

    // Avatar Border
    const themeColor = '#FFB6C1';
    ctx.strokeStyle = themeColor;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(avatarX + avatarSize/2, avatarY + avatarSize/2, avatarSize/2 + 3, 0, Math.PI * 2);
    ctx.stroke();

    // 4. Texts
    const textX = 240;
    const pinkColor = '#FFB6C1';
    
    // User Name (Nickname if provided)
    ctx.fillStyle = pinkColor;
    ctx.textAlign = 'left';
    ctx.font = `bold 42px ${fontStackBold}`;
    ctx.fillText(displayName || user.username, textX, 85);

    // LEVEL UP Text Badge
    ctx.fillStyle = themeColor;
    drawRoundedRect(ctx, textX, 105, 220, 40, 10);
    ctx.fillStyle = '#1a1a1a';
    ctx.font = `bold 22px ${fontStackBold}`;
    ctx.textAlign = 'center';
    ctx.fillText(`CHAT LEVEL UP!`, textX + 110, 133);

    // Level Number (Big)
    ctx.textAlign = 'right';
    ctx.fillStyle = pinkColor;
    ctx.font = `bold 100px ${fontStackBold}`;
    ctx.fillText(level, 930, 140);
    ctx.font = `bold 30px ${fontStackBold}`;
    ctx.fillText('LEVEL', 930, 55);

    // Progress Bar (Full for level up effect)
    const barWidth = 690;
    const barY = 185;
    ctx.fillStyle = 'rgba(255, 182, 193, 0.2)'; // Faint pink background
    drawRoundedRect(ctx, textX, barY, barWidth, 15, 7);
    
    const gradient = ctx.createLinearGradient(textX, 0, textX + barWidth, 0);
    gradient.addColorStop(0, themeColor);
    gradient.addColorStop(1, '#ffffff');
    ctx.fillStyle = gradient;
    drawRoundedRect(ctx, textX, barY, barWidth, 15, 7);

    // Subtext
    ctx.textAlign = 'left';
    ctx.fillStyle = pinkColor;
    ctx.font = `italic 22px ${fontStack}`;
    ctx.fillText(roleName || '🐾 Keep active to earn more rewards!', textX, 240);

    return await canvas.encode('png');
}

/**
 * Generates a Rank image card
 */
async function generateRankCard(user, level, currentXP, requiredXP, displayName = null, avatarURL = null, customStatus = null, customBackgroundURL = null) {
    const canvas = createCanvas(984, 282);
    const ctx = canvas.getContext('2d');

    // 1. Load Background
    await drawBackground(ctx, canvas.width, canvas.height, customBackgroundURL);

    // 2. Overlay
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    drawRoundedRect(ctx, 20, 20, 944, 242, 15);

    // 3. Avatar
    const avatarSize = 180;
    const avatarX = 50;
    const avatarY = 51;
    
    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarX + avatarSize/2, avatarY + avatarSize/2, avatarSize/2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    
    const finalAvatarURL = avatarURL || user.displayAvatarURL({ extension: 'png', size: 256 });
    const avatarImg = await loadImage(finalAvatarURL);
    ctx.drawImage(avatarImg, avatarX, avatarY, avatarSize, avatarSize);
    ctx.restore();

    // Border
    const themeColor = '#FFB6C1';
    ctx.strokeStyle = themeColor;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(avatarX + avatarSize/2, avatarY + avatarSize/2, avatarSize/2 + 3, 0, Math.PI * 2);
    ctx.stroke();

    // 4. Texts
    const pinkColor = '#FFB6C1';
    ctx.fillStyle = pinkColor;
    ctx.font = `bold 36px ${fontStackBold}`;
    ctx.textAlign = 'left';
    ctx.fillText(displayName || user.username, 260, 75);

    // Subtext / Badge
    ctx.fillStyle = 'rgba(255, 182, 193, 0.7)';
    ctx.font = `18px ${fontStack}`;
    ctx.fillText('PurrPaw Member Identification Card', 260, 105);

    // Progress Bar
    const barWidth = 650;
    const barX = 260;
    const barY = 175;

    ctx.fillStyle = 'rgba(255, 182, 193, 0.1)';
    drawRoundedRect(ctx, barX, barY, barWidth, 20, 10);

    const progress = Math.min(currentXP / Math.max(requiredXP, 1), 1);
    if (progress > 0) {
        const grad = ctx.createLinearGradient(barX, 0, barX + barWidth, 0);
        grad.addColorStop(0, '#FFB6C1');
        grad.addColorStop(1, '#FFD1DC');
        ctx.fillStyle = grad;
        drawRoundedRect(ctx, barX, barY, barWidth * progress, 20, 10);
    }

    // Texts on Bar
    ctx.fillStyle = pinkColor;
    ctx.font = `bold 20px ${fontStackBold}`;
    ctx.fillText(`💬 Chat Level: ${level}`, barX, barY - 12);
    
    ctx.textAlign = 'right';
    ctx.font = `18px ${fontStack}`;
    ctx.fillStyle = 'rgba(255, 182, 193, 0.8)';
    ctx.fillText(`${currentXP.toLocaleString()} / ${requiredXP.toLocaleString()} XP`, barX + barWidth, barY - 12);
    
    // Bottom message
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255, 182, 193, 0.6)';
    ctx.font = `italic 16px ${fontStack}`;
    ctx.fillText(customStatus || '🐾 Type more in chat to increase your rank!', barX, 230);

    return await canvas.encode('png');
}

/**
 * Generates a Leaderboard image card
 */
async function generateLeaderboardCard(topUsers, customBackgroundURL = null) {
    const canvas = createCanvas(984, 680);
    const ctx = canvas.getContext('2d');

    // 1. Draw Background
    await drawBackground(ctx, canvas.width, canvas.height, customBackgroundURL);

    // 2. Overlay
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    drawRoundedRect(ctx, 20, 20, 944, 640, 20);

    // 3. Header Text
    const pinkColor = '#FFB6C1';
    ctx.fillStyle = pinkColor;
    ctx.textAlign = 'center';
    ctx.font = `bold 32px ${fontStackBold}`;
    ctx.fillText('🏆 ตารางอันดับนักฝนเล็บแชทยอดเยี่ยม 🐾', canvas.width / 2, 75);

    // Header separator line
    ctx.strokeStyle = 'rgba(255, 182, 193, 0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(50, 95);
    ctx.lineTo(934, 95);
    ctx.stroke();

    // 4. Render rows
    const startY = 115;
    const rowHeight = 50;

    for (let i = 0; i < topUsers.length; i++) {
        const user = topUsers[i];
        const yPos = startY + i * rowHeight;

        // Row Background (Zebra Striping)
        ctx.fillStyle = i % 2 === 0 ? 'rgba(255, 182, 193, 0.05)' : 'rgba(0, 0, 0, 0.15)';
        drawRoundedRect(ctx, 40, yPos, 904, rowHeight - 6, 8);

        // 1. Rank Badge / Number
        ctx.textAlign = 'left';
        ctx.font = `bold 20px ${fontStackBold}`;
        let rankSymbol = `🐾 #${i + 1}`;
        if (i === 0) {
            rankSymbol = '🥇 #1';
            ctx.fillStyle = '#FFD700'; // Gold
        } else if (i === 1) {
            rankSymbol = '🥈 #2';
            ctx.fillStyle = '#C0C0C0'; // Silver
        } else if (i === 2) {
            rankSymbol = '🥉 #3';
            ctx.fillStyle = '#CD7F32'; // Bronze
        } else {
            ctx.fillStyle = '#ffffff'; // White for others
        }
        ctx.fillText(rankSymbol, 60, yPos + 30);

        // 2. Draw User Avatar
        ctx.save();
        const avatarSize = 34;
        const avatarX = 145;
        const avatarY = yPos + 5;
        
        ctx.beginPath();
        ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
        ctx.clip();

        try {
            const avatarImg = await loadImage(user.avatarURL);
            ctx.drawImage(avatarImg, avatarX, avatarY, avatarSize, avatarSize);
        } catch {
            // Draw placeholder circle
            ctx.fillStyle = '#FFB6C1';
            ctx.fill();
        }
        ctx.restore();

        // 3. User Name
        ctx.fillStyle = i === 0 ? '#FFD700' : (i === 1 ? '#e0e0e0' : (i === 2 ? '#ffcc99' : pinkColor));
        ctx.font = `bold 18px ${fontStackBold}`;
        ctx.textAlign = 'left';
        ctx.fillText(user.username, 200, yPos + 30);

        // 4. Level
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold 18px ${fontStackBold}`;
        ctx.textAlign = 'center';
        ctx.fillText(`LV. ${user.level}`, 620, yPos + 30);

        // 5. Total Characters (XP)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.font = `16px ${fontStack}`;
        ctx.textAlign = 'right';
        ctx.fillText(`${user.totalChars.toLocaleString()} ตัวอักษร`, 910, yPos + 30);
    }

    return await canvas.encode('png');
}

/**
 * Draws a placeholder card back if the image file is missing (checks for BG.png first)
 */
async function drawPlaceholderCard(ctx, w, h, isReversed, isTranslated = false) {
    ctx.save();
    if (!isTranslated) {
        ctx.translate(w / 2, h / 2);
    }
    if (isReversed) {
        ctx.rotate(Math.PI);
    }

    const bgPath = path.join(__dirname, 'assets', 'taro', 'BG.png');
    if (fs.existsSync(bgPath)) {
        try {
            const bgImg = await loadImage(bgPath);
            ctx.drawImage(bgImg, -w / 2, -h / 2, w, h);
            ctx.restore();
            return;
        } catch (err) {
            console.error('Failed to load BG.png fallback:', err);
        }
    }

    // Vector Fallback if BG.png doesn't exist
    ctx.fillStyle = '#2c1e2d';
    drawRoundedRect(ctx, -w / 2, -h / 2, w, h, 12);
    
    ctx.strokeStyle = '#FFB6C1';
    ctx.lineWidth = 4;
    ctx.strokeRect(-w / 2 + 8, -h / 2 + 8, w - 16, h - 16);

    ctx.strokeStyle = 'rgba(255, 182, 193, 0.4)';
    ctx.lineWidth = 2;
    ctx.strokeRect(-w / 2 + 16, -h / 2 + 16, w - 32, h - 32);

    ctx.fillStyle = '#FFB6C1';
    ctx.beginPath();
    ctx.arc(0, 0, 30, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#2c1e2d';
    ctx.beginPath();
    ctx.arc(10, -5, 25, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#FFB6C1';
    const fontStackBold = '"Leelawadee UI", sans-serif';
    ctx.font = `bold 16px ${fontStackBold}`;
    ctx.textAlign = 'center';
    ctx.fillText('PURRPAW TAROT', 0, 80);
    ctx.font = `italic 12px ${fontStackBold}`;
    ctx.fillText('Image not found', 0, 110);

    ctx.restore();
}

/**
 * Generates a single Tarot card image
 */
async function generateTarotOneCard(cardPath, isReversed) {
    const cardWidth = 300;
    const cardHeight = 500;
    const canvas = createCanvas(cardWidth, cardHeight);
    const ctx = canvas.getContext('2d');

    if (cardPath && fs.existsSync(cardPath)) {
        try {
            const cardImg = await loadImage(cardPath);
            if (isReversed) {
                ctx.translate(cardWidth / 2, cardHeight / 2);
                ctx.rotate(Math.PI);
                ctx.drawImage(cardImg, -cardWidth / 2, -cardHeight / 2, cardWidth, cardHeight);
            } else {
                ctx.drawImage(cardImg, 0, 0, cardWidth, cardHeight);
            }
        } catch (err) {
            console.error('Failed to load tarot card image:', err);
            await drawPlaceholderCard(ctx, cardWidth, cardHeight, isReversed);
        }
    } else {
        await drawPlaceholderCard(ctx, cardWidth, cardHeight, isReversed);
    }

    return await canvas.encode('png');
}

/**
 * Generates a composite image of 3 Tarot cards side by side (Past, Present, Future)
 */
async function generateTarotThreeCards(cardPaths, isReverseds) {
    const canvas = createCanvas(980, 540);
    const ctx = canvas.getContext('2d');

    // Draw a nice dark background
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, '#1c1b22');
    gradient.addColorStop(1, '#0e0d11');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Label header
    const fontStackBold = '"Leelawadee UI", sans-serif';
    ctx.fillStyle = '#FFB6C1';
    ctx.font = `bold 20px ${fontStackBold}`;
    ctx.textAlign = 'center';
    ctx.fillText('PAST (อดีต)', 180, 45);
    ctx.fillText('PRESENT (ปัจจุบัน)', 490, 45);
    ctx.fillText('FUTURE (อนาคต)', 800, 45);

    const cardWidth = 280;
    const cardHeight = 450;
    const startY = 60;
    const xOffsets = [40, 350, 660];

    for (let i = 0; i < 3; i++) {
        const cardPath = cardPaths[i];
        const isReversed = isReverseds[i];
        const x = xOffsets[i];

        ctx.save();
        if (cardPath && fs.existsSync(cardPath)) {
            try {
                const cardImg = await loadImage(cardPath);
                if (isReversed) {
                    ctx.translate(x + cardWidth / 2, startY + cardHeight / 2);
                    ctx.rotate(Math.PI);
                    ctx.drawImage(cardImg, -cardWidth / 2, -cardHeight / 2, cardWidth, cardHeight);
                } else {
                    ctx.drawImage(cardImg, x, startY, cardWidth, cardHeight);
                }
            } catch (err) {
                ctx.translate(x + cardWidth / 2, startY + cardHeight / 2);
                await drawPlaceholderCard(ctx, cardWidth, cardHeight, isReversed, true);
            }
        } else {
            ctx.translate(x + cardWidth / 2, startY + cardHeight / 2);
            await drawPlaceholderCard(ctx, cardWidth, cardHeight, isReversed, true);
        }
        ctx.restore();
    }

    return await canvas.encode('png');
}

module.exports = {
    registerSystemFonts,
    generateLevelUpCard,
    generateRankCard,
    generateLeaderboardCard,
    generateTarotOneCard,
    generateTarotThreeCards
};
