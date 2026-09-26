// ============================================================
// Haven Hair — js/leaves.js
// Draws animated autumn leaves falling from the tree on hero canvas.
//
// How it works:
//   - A fixed pool of Leaf objects is created once.
//   - Each frame: clear canvas → update each leaf position → draw it.
//   - When a leaf falls below the screen it resets to the tree crown area.
//   - treeX / treeY are recalculated on resize to follow the CSS tree position.
// ============================================================

const LeafAnimation = (() => {

    // ---- Config ----------------------------------------
    const LEAF_COUNT  = 28;

    // Autumn color palette — warm oranges, golds, deep reds
    const LEAF_COLORS = [
        '#e8602c',   // deep orange
        '#d4430d',   // rust red
        '#f0a020',   // amber orange
        '#c8902a',   // warm gold
        '#b03808',   // dark rust
        '#e87030',   // burnt orange
        '#d46020',   // clay orange
    ];

    // ---- Private state ---------------------------------
    let canvas  = null;
    let ctx     = null;
    let leaves  = [];
    let treeX   = 0;    // crown center X in pixels
    let treeY   = 0;    // crown center Y in pixels
    let running = false;

    // ---- Leaf factory ----------------------------------
    // spreadY: optional starting Y so leaves aren't all at the top on first load
    function makeLeaf(spreadY) {
        return {
            // position — starts near tree crown
            x:          treeX + (Math.random() - 0.5) * 150,
            y:          spreadY !== undefined ? spreadY : treeY + Math.random() * 50,

            // size
            w:          7  + Math.random() * 11,   // half-width of ellipse
            h:          4  + Math.random() * 7,    // half-height of ellipse

            // rotation
            rot:        Math.random() * Math.PI * 2,
            rotSpeed:   (Math.random() - 0.5) * 0.042,

            // falling
            fallSpeed:  0.45 + Math.random() * 1.25,

            // horizontal sway  x += sin(time * freq + phase) * 0.7
            swayAmp:    0.7,
            swayFreq:   0.009 + Math.random() * 0.016,
            swayPhase:  Math.random() * Math.PI * 2,

            // style
            color:      LEAF_COLORS[ Math.floor(Math.random() * LEAF_COLORS.length) ],
            opacity:    0.60 + Math.random() * 0.38,

            // internal clock — offset so leaves aren't visually synced
            time:       Math.random() * 1200,
        };
    }

    // ---- Draw one leaf (ellipse + center vein) ---------
    function drawLeaf(leaf) {
        ctx.save();
        ctx.translate(leaf.x, leaf.y);
        ctx.rotate(leaf.rot);
        ctx.globalAlpha = leaf.opacity;

        // Leaf body
        ctx.beginPath();
        ctx.ellipse(0, 0, leaf.w, leaf.h, 0, 0, Math.PI * 2);
        ctx.fillStyle = leaf.color;
        ctx.fill();

        // Center vein (subtle)
        ctx.beginPath();
        ctx.moveTo(-leaf.w * 0.75, 0);
        ctx.lineTo( leaf.w * 0.75, 0);
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.14)';
        ctx.lineWidth   = 0.6;
        ctx.stroke();

        ctx.restore();
    }

    // ---- Update leaf physics for one frame -------------
    function updateLeaf(leaf) {
        leaf.time += 1;

        // Fall downward
        leaf.y += leaf.fallSpeed;

        // Gentle side sway
        leaf.x += Math.sin(leaf.time * leaf.swayFreq + leaf.swayPhase) * leaf.swayAmp;

        // Tumble
        leaf.rot += leaf.rotSpeed;

        // Reset when leaf exits bottom of screen
        if (leaf.y > canvas.height + 30) {
            // Spawn fresh leaf at tree crown
            const fresh = makeLeaf(treeY - 20 + Math.random() * 40);
            Object.assign(leaf, fresh);
        }
    }

    // ---- Resize: match canvas to window & recalc tree position ----
    // The CSS tree-svg is: position absolute inside .scene (right:0, width:55%),
    // tree is right:12%, bottom:28%, width:200px.
    // Crown center is ~37% from top of the SVG viewBox (130/420 ≈ 0.31).
    // Approximate in viewport coords:
    //   treeX ≈ viewport_width  × 0.84
    //   treeY ≈ viewport_height × 0.35
    function resize() {
        canvas.width  = window.innerWidth;
        canvas.height = window.innerHeight;

        treeX = canvas.width  * 0.84;
        treeY = canvas.height * 0.35;

        // Relocate any leaves that are now off the right edge
        leaves.forEach(leaf => {
            if (leaf.x > canvas.width + 40) {
                Object.assign(leaf, makeLeaf(Math.random() * canvas.height));
            }
        });
    }

    // ---- Main animation loop ---------------------------
    function loop() {
        if (!running) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        leaves.forEach(leaf => {
            updateLeaf(leaf);
            drawLeaf(leaf);
        });

        requestAnimationFrame(loop);
    }

    // ---- Public: init ----------------------------------
    function init() {
        canvas = document.getElementById('leaf-canvas');
        if (!canvas) return;

        ctx = canvas.getContext('2d');

        resize();
        window.addEventListener('resize', resize);

        // Spread leaves across full screen height on first load
        // so the animation doesn't look empty for the first few seconds
        leaves = Array.from({ length: LEAF_COUNT }, (_, i) => {
            const spreadY = (canvas.height / LEAF_COUNT) * i;
            return makeLeaf(spreadY);
        });

        running = true;
        loop();
    }

    // ---- Expose only init ------------------------------
    return { init };

})();

// Start when DOM is ready
document.addEventListener('DOMContentLoaded', () => LeafAnimation.init());
