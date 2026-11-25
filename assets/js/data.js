window.ETI = window.ETI || {};

(function () {
  const CHAVE = 'eti:v2';
  const DURACAO_OVERRIDE = 3 * 3600000; // "marcar ocupada/vazia" vale por 3 horas

  const PADRAO = {
    sala: { id: 'sala01', nome: 'Sala 12', bloco: 'Bloco B', capacidade: 40 },
    telemetria: { temp: 26.8, umid: 61, lux: 438, potencia: 0, pessoas: 0, ts: 0 },
    estado: { iluminacao: true, ventilacao: false, projetor: false },
    config: {
      limiteTemp: 27,
      limiteLux: 300,
      horarioEconomia: '23:00',
      tarifa: 0.92,
      diasLetivos: 22,
      grade: [
        { dia: 1, inicio: '19:00', fim: '22:30' },
        { dia: 2, inicio: '19:00', fim: '22:30' },
        { dia: 3, inicio: '19:00', fim: '22:30' },
        { dia: 4, inicio: '19:00', fim: '22:30' },
        { dia: 5, inicio: '19:00', fim: '22:30' }
      ],
      // Escolhas do usuário
      modoManual: false,        // equipamentos mexidos à mão: limites de temperatura e luz suspensos
      economiaForcada: false,   // botão "Ativar modo economia"
      ocupacaoManual: null,     // null = segue a grade; true/false = marcada à mão
      ocupacaoManualAte: null,  // quando a marcação manual expira
      // Calculados pela automação
      modoEconomia: false,
      motivoEconomia: null      // 'forcada' | 'horario' | 'vazia' | null
    },
    equipamentos: [
      { id: 'iluminacao', nome: 'Iluminação', detalhe: '8 lâmpadas LED', potencia: 18, qtd: 8, horas: 5 },
      { id: 'ventilacao', nome: 'Ventilação', detalhe: '2 ventiladores de teto', potencia: 120, qtd: 2, horas: 4 },
      { id: 'projetor', nome: 'Projetor', detalhe: 'Projetor multimídia', potencia: 280, qtd: 1, horas: 3 },
      { id: 'ar', nome: 'Ar-condicionado', detalhe: 'Split 12.000 BTU', potencia: 1100, qtd: 1, horas: 4 },
      { id: 'computadores', nome: 'Computadores', detalhe: 'Estações de aluno', potencia: 150, qtd: 10, horas: 4 }
    ],
    solar: { custoInstalacao: 28000, geracaoMensal: 420, vidaUtil: 25 },
    avisos: [
      {
        id: 'a1',
        titulo: 'Entrega do Projeto Integrador',
        texto: 'Documentação final até sexta-feira, 06/11, na secretaria do curso.',
        ativo: true,
        criadoEm: Date.now() - 86400000
      },
      {
        id: 'a2',
        titulo: 'Manutenção no laboratório 3',
        texto: 'Laboratório fechado na terça pela manhã para troca de equipamentos.',
        ativo: true,
        criadoEm: Date.now() - 172800000
      }
    ],
    alertas: [],          // alertas do sistema ativos agora
    registroAlertas: [],  // histórico dos alertas disparados
    simulacao: { alvoPessoas: 0 },
    historico: []
  };

  const CONTROLAVEIS = ['iluminacao', 'ventilacao', 'projetor'];

  function clonar(o) { return JSON.parse(JSON.stringify(o)); }

  function carregar() {
    try {
      const bruto = localStorage.getItem(CHAVE);
      if (!bruto) return clonar(PADRAO);
      const salvo = JSON.parse(bruto);
      const base = clonar(PADRAO);
      const db = Object.assign(base, salvo);
      ['sala', 'telemetria', 'estado', 'config', 'solar', 'simulacao'].forEach(function (k) {
        db[k] = Object.assign({}, PADRAO[k], salvo[k] || {});
      });
      ['alertas', 'registroAlertas', 'avisos', 'historico', 'equipamentos'].forEach(function (k) {
        if (!Array.isArray(db[k])) db[k] = clonar(PADRAO[k]);
      });
      return db;
    } catch (e) {
      return clonar(PADRAO);
    }
  }

  function salvar() {
    try { localStorage.setItem(CHAVE, JSON.stringify(db)); } catch (e) {}
  }

  let db = carregar();

  // Antes de qualquer escrita, pega o que outras abas gravaram,
  // para não sobrescrever um aviso ou configuração feita em outra aba.
  function sincronizar() { db = carregar(); }

  if (!db.historico.length) {
    const agora = Date.now();
    for (let i = 23; i >= 0; i--) {
      const d = new Date(agora - i * 3600000);
      const h = d.getHours();
      const diurno = h >= 7 && h <= 18;
      const letivo = h >= 19 && h <= 22;
      db.historico.push({
        ts: d.getTime(),
        temp: +(22 + (diurno ? 5 : 2) + Math.sin(i / 3) * 1.8).toFixed(1),
        umid: Math.round(58 + Math.cos(i / 4) * 7),
        lux: diurno ? Math.round(520 + Math.sin(i / 2) * 170) : (letivo ? 410 : 14),
        potencia: letivo ? Math.round(500 + Math.sin(i) * 120) : (diurno ? 160 : 0)
      });
    }
    salvar();
  }

  /* ---------- Canais de inscrição ---------- */

  const canais = {
    telemetria: [], estado: [], config: [], avisos: [], historico: [], alertas: []
  };

  function valor(canal) {
    switch (canal) {
      case 'telemetria': return db.telemetria;
      case 'estado': return db.estado;
      case 'config': return db.config;
      case 'avisos': return db.avisos;
      case 'alertas': return { ativos: db.alertas, registro: db.registroAlertas };
      default: return db.historico;
    }
  }

  function emitir(canal) {
    canais[canal].forEach(function (fn) { fn(clonar(valor(canal))); });
  }

  function emitirTudo() {
    Object.keys(canais).forEach(emitir);
  }

  function inscrever(canal, fn) {
    canais[canal].push(fn);
    fn(clonar(valor(canal)));
    return function () {
      const i = canais[canal].indexOf(fn);
      if (i >= 0) canais[canal].splice(i, 1);
    };
  }

  /* ---------- Regras da sala ---------- */

  function minutos(hhmm) {
    const p = String(hhmm || '00:00').split(':');
    return (+p[0] || 0) * 60 + (+p[1] || 0);
  }

  function minutoAgora() {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }

  function potenciaAtual() {
    return db.equipamentos.reduce(function (s, eq) {
      return db.estado[eq.id] ? s + eq.potencia * eq.qtd : s;
    }, 0);
  }

  function overrideAtivo() {
    const c = db.config;
    if (c.ocupacaoManual === null || c.ocupacaoManual === undefined) return false;
    if (c.ocupacaoManualAte && Date.now() > c.ocupacaoManualAte) {
      c.ocupacaoManual = null;
      c.ocupacaoManualAte = null;
      return false;
    }
    return true;
  }

  function ocupadaPelaGrade() {
    const dia = new Date().getDay();
    const min = minutoAgora();
    return db.config.grade.some(function (f) {
      return f.dia === dia && min >= minutos(f.inicio) && min < minutos(f.fim);
    });
  }

  function ocupada() {
    return overrideAtivo() ? db.config.ocupacaoManual : ocupadaPelaGrade();
  }

  function motivoEconomia() {
    const c = db.config;
    if (c.economiaForcada) return 'forcada';
    // Alguém marcou a sala como ocupada: vale mais que o horário programado.
    if (overrideAtivo() && c.ocupacaoManual === true) return null;
    if (!ocupada()) return 'vazia';
    if (minutoAgora() >= minutos(c.horarioEconomia)) return 'horario';
    return null;
  }

  // Mesma lógica que o ESP32 vai rodar: economia corta tudo; fora dela,
  // os limites ligam e desligam com histerese, a menos que alguém tenha
  // assumido os equipamentos à mão.
  function automacoes() {
    const motivo = motivoEconomia();
    db.config.motivoEconomia = motivo;
    db.config.modoEconomia = motivo !== null;

    if (motivo) {
      CONTROLAVEIS.forEach(function (id) { db.estado[id] = false; });
      return;
    }

    if (db.config.modoManual) return;

    if (db.telemetria.temp > db.config.limiteTemp) db.estado.ventilacao = true;
    else if (db.telemetria.temp < db.config.limiteTemp - 1.5) db.estado.ventilacao = false;

    if (db.telemetria.lux < db.config.limiteLux) db.estado.iluminacao = true;
    else if (db.telemetria.lux > db.config.limiteLux + 120) db.estado.iluminacao = false;
  }

  /* ---------- Alertas do sistema ---------- */

  function num(v, casas) {
    return v.toLocaleString('pt-BR', { minimumFractionDigits: casas || 0, maximumFractionDigits: casas || 0 });
  }

  // Cada regra tem uma condição para disparar e outra (mais folgada) para continuar
  // ativa. Isso evita o alerta piscar quando o valor fica oscilando em cima do limite.
  function regrasDeAlerta() {
    const t = db.telemetria;
    const c = db.config;
    const e = db.estado;
    const cap = db.sala.capacidade || 0;
    const temGente = ocupada();

    return [
      {
        id: 'calor',
        disparar: temGente && t.temp > c.limiteTemp,
        manter: temGente && t.temp > c.limiteTemp - 0.5,
        titulo: 'Sala muito quente',
        texto: num(t.temp, 1) + ' °C, acima do limite de ' + num(c.limiteTemp, 1) + ' °C. ' +
          (e.ventilacao
            ? 'A ventilação já está ligada; se não baixar, ligue a climatização.'
            : 'Ligue a climatização.')
      },
      {
        id: 'frio',
        disparar: temGente && t.temp < 18,
        manter: temGente && t.temp < 19,
        titulo: 'Sala fria',
        texto: num(t.temp, 1) + ' °C. Desligue a ventilação e feche as janelas.'
      },
      {
        id: 'umidade-alta',
        disparar: temGente && t.umid > 75,
        manter: temGente && t.umid > 70,
        titulo: 'Umidade alta',
        texto: 'Umidade em ' + t.umid + '%. Ventile a sala.'
      },
      {
        id: 'umidade-baixa',
        disparar: temGente && t.umid < 40,
        manter: temGente && t.umid < 45,
        titulo: 'Ar seco',
        texto: 'Umidade em ' + t.umid + '%. Recomenda-se umidificar o ambiente e beber água.'
      },
      {
        id: 'pouca-luz',
        disparar: temGente && t.lux < c.limiteLux && !e.iluminacao,
        manter: temGente && t.lux < c.limiteLux + 50 && !e.iluminacao,
        titulo: 'Pouca luz',
        texto: num(t.lux) + ' lux, abaixo do mínimo de ' + num(c.limiteLux) + ' lux. Ligue a iluminação.'
      },
      {
        id: 'lotacao',
        disparar: cap > 0 && t.pessoas > cap,
        manter: cap > 0 && t.pessoas > cap,
        titulo: 'Sala acima da capacidade',
        texto: t.pessoas + ' pessoas para ' + cap + ' lugares. Remaneje alunos para outra sala.'
      },
      {
        id: 'quase-lotada',
        disparar: cap > 0 && t.pessoas >= Math.ceil(cap * 0.9) && t.pessoas <= cap,
        manter: cap > 0 && t.pessoas >= Math.ceil(cap * 0.85) && t.pessoas <= cap,
        titulo: 'Sala quase lotada',
        texto: t.pessoas + ' de ' + cap + ' lugares ocupados.'
      }
    ];
  }

  function avaliarAlertas() {
    const antes = {};
    db.alertas.forEach(function (a) { antes[a.id] = a; });

    const agora = Date.now();
    const ativos = [];
    let mudou = false;

    regrasDeAlerta().forEach(function (r) {
      const estava = antes[r.id];
      const fica = estava ? r.manter : r.disparar;
      if (!fica) { if (estava) mudou = true; return; }

      if (!estava) {
        mudou = true;
        db.registroAlertas.unshift({ id: r.id + '-' + agora, tipo: r.id, titulo: r.titulo, texto: r.texto, ts: agora });
        if (db.registroAlertas.length > 30) db.registroAlertas.length = 30;
      } else if (estava.texto !== r.texto) {
        mudou = true;
      }
      ativos.push({ id: r.id, titulo: r.titulo, texto: r.texto, desde: estava ? estava.desde : agora });
    });

    db.alertas = ativos;
    return mudou;
  }

  /* ---------- Simulação ---------- */

  function variar(v, amplitude, min, max) {
    return Math.min(max, Math.max(min, v + (Math.random() - 0.5) * amplitude));
  }

  function simularPessoas() {
    const t = db.telemetria;
    const sim = db.simulacao;
    const cap = db.sala.capacidade || 40;

    if (!ocupada()) {
      sim.alvoPessoas = 0;
    } else if (sim.alvoPessoas === 0) {
      // A aula começou: a turma vai chegando aos poucos.
      sim.alvoPessoas = Math.round(cap * (0.55 + Math.random() * 0.25));
    }

    if (t.pessoas < sim.alvoPessoas) t.pessoas = Math.min(sim.alvoPessoas, t.pessoas + 1 + Math.floor(Math.random() * 3));
    else if (t.pessoas > sim.alvoPessoas) t.pessoas = Math.max(sim.alvoPessoas, t.pessoas - 2 - Math.floor(Math.random() * 3));
    else if (sim.alvoPessoas > 0 && Math.random() < 0.08) {
      // Alguém sai ou chega no meio da aula.
      // Só passa da capacidade se alguém ajustou à mão.
      const novo = sim.alvoPessoas + (Math.random() < 0.5 ? -1 : 1);
      sim.alvoPessoas = Math.max(1, novo > cap && novo > sim.alvoPessoas ? sim.alvoPessoas : novo);
    }
  }

  function simularAmbiente() {
    const t = db.telemetria;
    const cap = db.sala.capacidade || 40;
    const h = new Date().getHours();

    // Gente esquenta a sala; ventilação esfria.
    const alvoTemp = 24 + 4 * (t.pessoas / cap) - (db.estado.ventilacao ? 2 : 0);
    t.temp = +variar(t.temp + (alvoTemp - t.temp) * 0.04, 0.3, 15, 36).toFixed(1);
    t.umid = Math.round(variar(t.umid, 2, 30, 90));

    // Luz natural conforme a hora, mais a iluminação da sala.
    const natural = h >= 7 && h < 18 ? 480 : (h >= 18 && h < 19 ? 180 : 25);
    const alvoLux = natural + (db.estado.iluminacao ? 360 : 0);
    t.lux = Math.round(variar(t.lux + (alvoLux - t.lux) * 0.25, 30, 0, 1500));
  }

  function propagar() {
    db.telemetria.potencia = potenciaAtual();
    avaliarAlertas();
    salvar();
    emitir('config');
    emitir('estado');
    emitir('telemetria');
    emitir('alertas');
  }

  // Envolve toda escrita: sincroniza com outras abas, aplica, recalcula e avisa.
  function alterar(fn) {
    sincronizar();
    fn();
    automacoes();
    propagar();
  }

  let timer = null;

  function passo() {
    sincronizar();

    // Outra aba já atualizou há pouco: só mostra o que ela gravou.
    if (Date.now() - db.telemetria.ts < 2500) return;

    simularPessoas();
    simularAmbiente();
    automacoes();
    db.telemetria.potencia = potenciaAtual();
    db.telemetria.ts = Date.now();
    avaliarAlertas();

    const ultimo = db.historico[db.historico.length - 1];
    const novoPonto = !ultimo || Date.now() - ultimo.ts > 60000;
    if (novoPonto) {
      db.historico.push({
        ts: Date.now(),
        temp: db.telemetria.temp,
        umid: db.telemetria.umid,
        lux: db.telemetria.lux,
        potencia: db.telemetria.potencia
      });
      if (db.historico.length > 48) db.historico.shift();
    }

    salvar();
    emitir('telemetria');
    emitir('estado');
    emitir('config');
    emitir('alertas');
    if (novoPonto) emitir('historico');
  }

  function iniciar() {
    if (timer) return;
    automacoes();
    avaliarAlertas();
    timer = setInterval(passo, 3000);
  }

  // Outra aba gravou: recarrega e repassa às telas na hora.
  window.addEventListener('storage', function (e) {
    if (e.key !== CHAVE) return;
    sincronizar();
    emitirTudo();
  });

  /* ---------- API pública ---------- */

  ETI.data = {
    modo: 'simulado',
    controlaveis: CONTROLAVEIS.slice(),

    sala: function () { return clonar(db.sala); },
    ocupada: ocupada,

    // { ocupada, manual, ate } — de onde vem a ocupação atual
    ocupacao: function () {
      const manual = overrideAtivo();
      return { ocupada: ocupada(), manual: manual, ate: manual ? db.config.ocupacaoManualAte : null };
    },

    onTelemetria: function (fn) { return inscrever('telemetria', fn); },
    onEstado: function (fn) { return inscrever('estado', fn); },
    onConfig: function (fn) { return inscrever('config', fn); },
    onAvisos: function (fn) { return inscrever('avisos', fn); },
    onHistorico: function (fn) { return inscrever('historico', fn); },
    onAlertas: function (fn) { return inscrever('alertas', fn); },

    // Ligar ou desligar à mão suspende os limites automáticos até "retomar automações".
    setEstado: function (id, ligado) {
      alterar(function () {
        db.config.modoManual = true;
        db.estado[id] = !!ligado;
      });
    },

    setConfig: function (patch) {
      alterar(function () { Object.assign(db.config, patch); });
    },

    // true = ocupada, false = vazia, null = volta a seguir a grade
    setOcupacao: function (valor) {
      alterar(function () {
        if (valor === null) {
          db.config.ocupacaoManual = null;
          db.config.ocupacaoManualAte = null;
        } else {
          db.config.ocupacaoManual = !!valor;
          db.config.ocupacaoManualAte = Date.now() + DURACAO_OVERRIDE;
        }
      });
    },

    setPessoas: function (n) {
      alterar(function () {
        const max = Math.round((db.sala.capacidade || 40) * 1.5);
        const v = Math.max(0, Math.min(max, Math.round(n)));
        db.telemetria.pessoas = v;
        db.simulacao.alvoPessoas = v;
      });
    },

    forcarEconomia: function () {
      alterar(function () { db.config.economiaForcada = true; });
    },

    desativarEconomia: function () {
      alterar(function () { db.config.economiaForcada = false; });
    },

    // Desfaz tudo que foi feito à mão: economia forçada, equipamentos e ocupação.
    retomarAutomatico: function () {
      alterar(function () {
        db.config.modoManual = false;
        db.config.economiaForcada = false;
        db.config.ocupacaoManual = null;
        db.config.ocupacaoManualAte = null;
      });
    },

    equipamentos: function () { return clonar(db.equipamentos); },

    setEquipamentos: function (lista) {
      alterar(function () { db.equipamentos = clonar(lista); });
    },

    solar: function () { return clonar(db.solar); },

    setSolar: function (patch) {
      sincronizar();
      Object.assign(db.solar, patch);
      salvar();
    },

    addAviso: function (a) {
      sincronizar();
      db.avisos.unshift({
        id: 'a' + Date.now(),
        titulo: a.titulo,
        texto: a.texto,
        ativo: true,
        criadoEm: Date.now()
      });
      salvar();
      emitir('avisos');
    },

    setAvisoAtivo: function (id, ativo) {
      sincronizar();
      const a = db.avisos.find(function (x) { return x.id === id; });
      if (a) { a.ativo = !!ativo; salvar(); emitir('avisos'); }
    },

    removerAviso: function (id) {
      sincronizar();
      db.avisos = db.avisos.filter(function (x) { return x.id !== id; });
      salvar();
      emitir('avisos');
    },

    limparRegistroAlertas: function () {
      sincronizar();
      db.registroAlertas = [];
      salvar();
      emitir('alertas');
    },

    historico: function () { return clonar(db.historico); },

    reiniciar: function () {
      try { localStorage.removeItem(CHAVE); } catch (e) {}
      location.reload();
    },

    iniciar: iniciar
  };

  iniciar();
})();
