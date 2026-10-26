<script>
  // Página interna #/design (só em dev; App.svelte a carrega por import dinâmico atrás de import.meta.env.DEV).
  // Mostra tokens e componentes em claro e escuro lado a lado.
  import Button from './ui/Button.svelte';
  import IconButton from './ui/IconButton.svelte';
  import Icon from './ui/Icon.svelte';
  import { ICONS } from './ui/icons.js';
  import TextInput from './ui/TextInput.svelte';
  import Select from './ui/Select.svelte';
  import MoneyInput from './ui/MoneyInput.svelte';
  import Money from './ui/Money.svelte';
  import Badge from './ui/Badge.svelte';
  import Switch from './ui/Switch.svelte';
  import Segmented from './ui/Segmented.svelte';
  import Sheet from './ui/Sheet.svelte';
  import { confirmDialog } from './ui/confirm.js';

  let cvd = $state(false);
  let sheet = $state(false);
  let dlg = $state(false);
  let last = $state('');

  // As variáveis de tema só existem em :root/<html>. Para ver os dois temas lado a lado, copiamos as
  // declarações das regras do tokens.css (lidas do CSSOM) para o wrapper de cada painel.
  function themed(node, { theme, cvd }) {
    const apply = (theme, cvd) => {
      const sels = [':root', theme === 'dark' && ':root[data-theme="dark"]', cvd && ':root[data-cvd="on"]', cvd && theme === 'dark' && ':root[data-cvd="on"][data-theme="dark"]'];
      node.removeAttribute('style');
      for (const sel of sels.filter(Boolean)) for (const sh of document.styleSheets) {
        let rules; try { rules = sh.cssRules; } catch { continue; }
        for (const r of rules) if (r.selectorText === sel) for (const name of r.style) if (name.startsWith('--')) node.style.setProperty(name, r.style.getPropertyValue(name));
      }
      node.style.colorScheme = theme;
    };
    apply(theme, cvd);
    return { update: (o) => apply(o.theme, o.cvd) };
  }

  const SURFACES = ['surface-page', 'surface-raised', 'surface-sunken', 'border-subtle', 'border-strong', 'text-strong', 'text-body', 'text-muted', 'brand', 'brand-soft', 'brand-strong', 'focus-ring'];
  const FIN = ['income', 'expense', 'transfer', 'forecast', 'overdue', 'pending', 'settled'];
  const SPACES = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16];
  const FRUITS = [['income', 'Receita'], ['expense', 'Despesa'], ['forecast', 'Previsto'], ['overdue', 'Atrasado'], ['pending', 'Pendente'], ['settled', 'Efetivado'], ['brand', 'Marca'], ['neutral', 'Neutro']];
  const THEMES = [['system', 'Sistema'], ['light', 'Claro'], ['dark', 'Escuro']];
  let seg = $state('light');
  let sw = $state(true);
  let cents = $state(123456);
  let text = $state('');
  let sel = $state('b');

  async function ask(danger) {
    last = String(await confirmDialog({ title: danger ? 'Excluir lançamento?' : 'Efetivar agora?', message: danger ? 'Esta ação não pode ser desfeita.' : 'O saldo atual será atualizado.', confirmLabel: danger ? 'Excluir' : 'Efetivar', danger }));
  }
</script>

<main class="page">
  <header>
    <h1>Design system</h1>
    <p class="muted">Dev only · tokens e componentes em <code>src/ui/</code></p>
    <label class="opt"><Switch bind:checked={cvd} label="Modo daltônico" /> <span>Modo daltônico</span></label>
  </header>

  <div class="panes">
    {#each ['light', 'dark'] as theme (theme)}
      <section class="pane" use:themed={{ theme, cvd }}>
        <h2>Tema {theme === 'light' ? 'claro' : 'escuro'}</h2>

        <h3>Cores</h3>
        <div class="sw">
          {#each SURFACES as n (n)}<div><i style:background="var(--{n})"></i>{n}</div>{/each}
          {#each FIN as n (n)}<div><i style:background="var(--color-{n})"></i>color-{n}</div>{/each}
        </div>
        <h3>Categorias</h3>
        <div class="cats">{#each Array(10) as _, i (i)}<i style:background="var(--cat-{i + 1})">{i + 1}</i>{/each}</div>

        <h3>Tipografia</h3>
        <p class="t-display">Fredoka · títulos 26</p>
        <p class="t-text">Nunito · texto 16 / <small>12 pequeno</small></p>
        <p><Money cents={123456} size="lg" /> <Money cents={123456} size="md" /> <Money cents={123456} size="sm" /></p>

        <h3>Espaçamento</h3>
        <div class="space">{#each SPACES as s (s)}<div><i style:width="var(--space-{s})"></i>space-{s}</div>{/each}</div>

        <h3>Button</h3>
        <div class="row">
          <Button>Primário</Button><Button variant="secondary">Secundário</Button><Button variant="ghost">Ghost</Button><Button variant="danger"><Icon name="trash" size="sm" />Excluir</Button>
        </div>
        <div class="row">
          <Button size="sm">Pequeno</Button><Button loading>Salvando</Button><Button disabled>Desabilitado</Button><Button variant="secondary" disabled>Desab.</Button>
        </div>
        <Button block><Icon name="plus" size="sm" />Bloco com ícone</Button>

        <h3>IconButton</h3>
        <div class="row">
          <IconButton icon="plus" label="Novo lançamento" tone="brand" /><IconButton icon="edit" label="Editar" tone="soft" /><IconButton icon="trash" label="Excluir" tone="muted" /><IconButton icon="dots" label="Mais ações" /><IconButton icon="left" label="Mês anterior" disabled />
        </div>

        <h3>Ícones</h3>
        <div class="icons">{#each Object.keys(ICONS) as n (n)}<div><Icon name={n} />{n}</div>{/each}</div>

        <h3>Campos</h3>
        <div class="stack">
          <TextInput label="Descrição" help="Como aparece na lista" bind:value={text} placeholder="Mercado" />
          <TextInput label="Com erro" error="Informe uma descrição" value="" />
          <Select label="Conta" bind:value={sel} options={[['a', 'Carteira'], ['b', 'Banco'], ['c', 'Cartão']]} />
          <MoneyInput label="Valor" bind:value={cents} help="Digite só os números" />
          <MoneyInput label="Valor com erro" error="Valor deve ser maior que zero" value={0} />
          <TextInput label="Desabilitado" value="Bloqueado" disabled />
        </div>

        <h3>Money</h3>
        <div class="stack">
          {#each FRUITS as [k, t] (k)}<div class="line"><span>{t}</span><Money cents={4590} kind={k === 'brand' ? 'neutral' : k} /></div>{/each}
          <div class="line"><span>Negativo</span><Money cents={-4590} /></div>
        </div>

        <h3>Badge</h3>
        <div class="row">
          <Badge icon="check" tone="settled">Efetivado</Badge><Badge icon="clock" tone="pending">Pendente</Badge><Badge icon="alert" tone="overdue">Atrasado</Badge><Badge icon="calendar" tone="forecast">Em breve</Badge><Badge icon="cloud-off" tone="overdue">Não enviado</Badge><Badge tone="income">Receita</Badge><Badge tone="expense">Despesa</Badge><Badge tone="brand">Marca</Badge><Badge>Neutro</Badge>
        </div>

        <h3>Switch e Segmented</h3>
        <div class="stack">
          <label class="opt"><Switch bind:checked={sw} label="Ligado" /> <span>{sw ? 'Ligado' : 'Desligado'}</span></label>
          <label class="opt"><Switch checked={false} label="Desligado" /> <span>Desligado</span></label>
          <label class="opt"><Switch checked disabled label="Desabilitado" /> <span>Desabilitado</span></label>
          <Segmented label="Tema" options={THEMES} bind:value={seg} />
        </div>
      </section>
    {/each}
  </div>

  <h2>Sobreposições</h2>
  <div class="row">
    <Button variant="secondary" onclick={() => (sheet = true)}>Abrir Sheet</Button>
    <Button variant="secondary" onclick={() => (dlg = true)}>Abrir Dialog</Button>
    <Button variant="secondary" onclick={() => ask(false)}>confirmDialog</Button>
    <Button variant="danger" onclick={() => ask(true)}>confirmDialog (danger)</Button>
  </div>
  <p class="muted">Último confirm: {last || '—'}</p>
</main>

{#if sheet}
  <Sheet title="Novo lançamento" onclose={() => (sheet = false)}>
    <TextInput label="Descrição" bind:value={text} />
    <MoneyInput label="Valor" bind:value={cents} />
    <Button block onclick={() => (sheet = false)}>Salvar</Button>
  </Sheet>
{/if}
{#if dlg}
  <Sheet center title="Dialog simples" onclose={() => (dlg = false)}>
    <p class="muted">Centrado, foco preso, Escape fecha.</p>
    <Button block onclick={() => (dlg = false)}>Entendi</Button>
  </Sheet>
{/if}

<style>
  .page { max-width: 80rem; margin: 0 auto; padding: var(--space-4); }
  h1, h2, h3 { font-family: var(--font-display); color: var(--text-strong); margin: var(--space-4) 0 var(--space-2); }
  h3 { font-size: var(--fs-3); color: var(--text-muted); }
  .muted { color: var(--text-muted); }
  .panes { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr)); gap: var(--space-4); }
  .pane { background: var(--surface-page); color: var(--text-body); border: var(--bw-1) solid var(--border-subtle); border-radius: var(--radius-3); padding: var(--space-4); min-width: 0; }
  .row { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; }
  .stack { display: flex; flex-direction: column; gap: var(--space-3); }
  .line { display: flex; justify-content: space-between; align-items: center; min-height: var(--tap); }
  .opt { display: flex; align-items: center; gap: var(--space-2); }
  .sw { display: grid; grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr)); gap: var(--space-2); font-size: var(--fs-1); }
  .sw div { display: flex; align-items: center; gap: var(--space-2); }
  .sw i { width: 24px; height: 24px; border-radius: var(--radius-1); border: var(--bw-1) solid var(--border-strong); flex: none; }
  .cats { display: grid; grid-template-columns: repeat(10, 1fr); gap: var(--space-1); }
  .cats i { aspect-ratio: 1; border-radius: var(--radius-1); display: grid; place-items: center; font: var(--fw-bold) var(--fs-1) var(--font-text); color: var(--cat-ink-light); font-style: normal; }
  .t-display { font: var(--fw-display) var(--fs-5)/var(--lh-snug) var(--font-display); margin: 0; }
  .t-text { font: var(--fw-medium) var(--fs-3)/var(--lh-body) var(--font-text); margin: 0; }
  .space { display: flex; flex-direction: column; gap: var(--space-1); font-size: var(--fs-1); }
  .space div { display: flex; align-items: center; gap: var(--space-2); }
  .space i { height: 8px; background: var(--brand); border-radius: var(--radius-pill); }
  .icons { display: grid; grid-template-columns: repeat(auto-fill, minmax(5.5rem, 1fr)); gap: var(--space-2); font-size: var(--fs-1); color: var(--text-muted); }
  .icons div { display: flex; flex-direction: column; align-items: center; gap: var(--space-1); color: var(--text-strong); }
</style>
