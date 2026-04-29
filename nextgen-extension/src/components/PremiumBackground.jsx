import React from 'react';

const CSS = `
.prem-page{font-family:'Outfit',system-ui,sans-serif;position:relative}
.prem-orb{position:fixed;border-radius:50%;filter:blur(90px);pointer-events:none;will-change:transform;z-index:0}
.prem-orb-a{width:480px;height:480px;background:oklch(from var(--color-primary) l c h / 0.06);top:-10%;right:-6%;animation:prem-drift-a 26s ease-in-out infinite}
.prem-orb-b{width:380px;height:380px;background:oklch(from var(--color-secondary) l c h / 0.05);bottom:-12%;left:-5%;animation:prem-drift-b 32s ease-in-out infinite}
@keyframes prem-drift-a{0%,100%{transform:translate(0,0) scale(1)}25%{transform:translate(-40px,30px) scale(1.04)}50%{transform:translate(20px,-45px) scale(.96)}75%{transform:translate(30px,20px) scale(1.02)}}
@keyframes prem-drift-b{0%,100%{transform:translate(0,0) scale(1)}25%{transform:translate(35px,-25px) scale(1.03)}50%{transform:translate(-25px,40px) scale(.97)}75%{transform:translate(-35px,-10px) scale(1.01)}}
.prem-grid{position:fixed;inset:0;pointer-events:none;background-image:radial-gradient(circle,oklch(from var(--color-base-content) l c h / 0.025) 1px,transparent 1px);background-size:28px 28px;z-index:0}
.prem-scroll{scrollbar-width:thin;scrollbar-color:var(--color-base-300) transparent}
.prem-scroll::-webkit-scrollbar{width:5px}
.prem-scroll::-webkit-scrollbar-track{background:transparent}
.prem-scroll::-webkit-scrollbar-thumb{background:var(--color-base-300);border-radius:3px}
.prem-glass{background:var(--color-base-100);border:1px solid var(--color-base-300);border-radius:12px;overflow:hidden}
.prem-card{background:var(--color-base-100);border:1px solid var(--color-base-300);border-radius:12px;overflow:hidden;transition:border-color .2s,box-shadow .2s}
.prem-card:hover{border-color:oklch(from var(--color-base-content) l c h / 0.12);box-shadow:0 4px 20px oklch(from var(--color-base-content) l c h / 0.06)}
.prem-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:34px;padding:0 14px;border-radius:9px;font-size:13px;font-weight:500;font-family:'Outfit',system-ui,sans-serif;cursor:pointer;transition:all .15s ease;border:1px solid var(--color-base-300);background:var(--color-base-100);color:var(--color-base-content);opacity:.7}
.prem-btn:hover{opacity:1;background:var(--color-base-200)}
.prem-btn-prim{color:var(--color-primary-content);background:var(--color-primary);border:none;opacity:1;box-shadow:0 2px 12px oklch(from var(--color-primary) l c h / 0.25)}
.prem-btn-prim:hover{filter:brightness(1.1);transform:translateY(-1px);box-shadow:0 4px 18px oklch(from var(--color-primary) l c h / 0.35)}
.prem-btn-err{color:var(--color-error);background:oklch(from var(--color-error) l c h / 0.08);border-color:oklch(from var(--color-error) l c h / 0.15);opacity:1}
.prem-btn-err:hover{background:oklch(from var(--color-error) l c h / 0.12)}
.prem-btn-warn{color:var(--color-warning);background:oklch(from var(--color-warning) l c h / 0.08);border-color:oklch(from var(--color-warning) l c h / 0.15);opacity:1}
.prem-btn-warn:hover{background:oklch(from var(--color-warning) l c h / 0.12)}
.prem-input{width:100%;height:36px;padding:0 12px;font-size:13px;font-family:'Outfit',system-ui,sans-serif;color:var(--color-base-content);background:var(--color-base-100);border:1px solid var(--color-base-300);border-radius:9px;outline:none;transition:all .2s ease}
.prem-input:focus{border-color:var(--color-primary);box-shadow:0 0 0 2px oklch(from var(--color-primary) l c h / 0.1)}
.prem-input::placeholder{opacity:.35}
.prem-badge{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:7px;font-size:11px;font-weight:500;font-family:'Outfit',system-ui,sans-serif}
.prem-badge-ok{color:var(--color-success);background:oklch(from var(--color-success) l c h / 0.08)}
.prem-badge-err{color:var(--color-error);background:oklch(from var(--color-error) l c h / 0.08)}
.prem-badge-warn{color:var(--color-warning);background:oklch(from var(--color-warning) l c h / 0.08)}
.prem-badge-info{color:var(--color-info);background:oklch(from var(--color-info) l c h / 0.08)}
.prem-title{font-size:13px;font-weight:600;color:var(--color-base-content);line-height:1.2}
.prem-sub{font-size:11px;color:var(--color-base-content);opacity:.4;line-height:1.2;margin-top:2px}
.prem-divider{height:1px;background:var(--color-base-300);margin:16px 0}
`;

export default function PremiumBackground() {
  return (
    <>
      <style>{CSS}</style>
      <div className="prem-grid" />
      <div className="prem-orb prem-orb-a" />
      <div className="prem-orb prem-orb-b" />
    </>
  );
}

export { CSS as PREMIUM_CSS };
