window.GTO = window.GTO || {};
GTO.UI = GTO.UI || {};

GTO.UI.Charts = {
  // Most chart rendering is in dashboard.js
  // This provides shared chart utilities

  drawGrid: function(ctx, w, h, rows, color) {
    ctx.strokeStyle = color || '#1a1a1a';
    ctx.lineWidth = 1;
    for (var i = 0; i <= rows; i++) {
      var y = Math.round(h * i / rows) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  },

  drawLine: function(ctx, points, color, width) {
    if (points.length < 2) return;
    ctx.strokeStyle = color || getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ff8c00';
    ctx.lineWidth = width || 2;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (var i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();
  },

  drawDots: function(ctx, points, color, radius) {
    ctx.fillStyle = color || getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ff8c00';
    points.forEach(function(p) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius || 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }
};
