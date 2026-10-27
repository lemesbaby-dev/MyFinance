<script>
  import Money from './Money.svelte';
  import Badge from './Badge.svelte';
  import Icon from './Icon.svelte';
  import { moneyText } from './money.js';
  import { trailPct } from './logic.js';
  // Trilha "hoje -> previsto". now/forecast em centavos; done/todo = movimento efetivado / ainda previsto no período (define quanto da trilha está preenchido).
  let { now, forecast, done = 0, todo = 0, nowLabel = 'Hoje', forecastLabel = 'Previsto' } = $props();
  const p = $derived(trailPct(done, todo));
  const delta = $derived(forecast - now);
  const desc = $derived(`${nowLabel} ${moneyText(now)}, ${forecastLabel.toLowerCase()} ${moneyText(forecast)}; ${Math.round(p)}% do movimento já efetivado`);
</script>

<div class="ui-hero">
  <div class="cols">
    <div><span class="cap">{nowLabel}</span><Money cents={now} size="lg" /></div>
    <div class="end"><span class="cap">{forecastLabel}</span><Money cents={forecast} kind="forecast" size="lg" /></div>
  </div>
  <div class="trail" role="img" aria-label={desc} style:--p="{p}%">
    <span class="rail"></span><span class="fill"></span>
    <span class="dot now"><Icon name="check" size="sm" /></span>
    <span class="dot goal"></span>
  </div>
  <div><Badge tone="forecast" icon="calendar">{delta < 0 ? 'Vão sair' : 'Vão entrar'} {moneyText(Math.abs(delta), 'neutral', false)} até o fim</Badge></div>
</div>

<style>
  .ui-hero { padding: var(--space-4); border-radius: var(--card-radius); background: var(--surface-raised); border: var(--bw-1) solid var(--border-subtle); display: flex; flex-direction: column; gap: var(--space-2); }
  .cols { display: flex; justify-content: space-between; align-items: flex-end; flex-wrap: wrap; gap: var(--space-2) var(--space-4); }
  .cols > div { display: flex; flex-direction: column; gap: var(--space-1); }
  .end { text-align: right; align-items: flex-end; }
  .cap { font: var(--fw-bold) var(--fs-1)/var(--lh-tight) var(--font-text); color: var(--text-muted); letter-spacing: 0.06em; text-transform: uppercase; }
  .trail { position: relative; height: var(--space-8); margin: 0 var(--space-2); }
  .rail { position: absolute; left: 0; right: 0; top: 50%; border-top: 3px dotted var(--border-strong); }
  .fill { position: absolute; left: 0; width: var(--p); top: 50%; height: 3px; transform: translateY(-50%); background: var(--color-forecast); border-radius: var(--radius-1); transition: width var(--dur-slow) var(--ease-out); }
  .dot { position: absolute; top: 50%; width: var(--space-5); height: var(--space-5); margin-top: calc(var(--space-5) / -2); border-radius: var(--radius-pill); display: grid; place-items: center; box-sizing: border-box; }
  .now { left: calc(var(--space-2) * -1); background: var(--brand); color: var(--on-brand); }
  .goal { right: calc(var(--space-2) * -1); background: var(--surface-raised); border: 3px dashed var(--color-forecast); }
</style>
