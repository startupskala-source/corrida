# Revisão de textos para o tom da marca (BRAND.md). Roda uma vez: python scripts/copy-pass.py
def edit(p, pairs):
    s = open(p, encoding='utf-8').read()
    for a, b in pairs:
        if a not in s:
            print('NAO ACHEI em', p, ':', a[:70]); continue
        s = s.replace(a, b)
    open(p, 'w', encoding='utf-8').write(s)

edit('index.html', [
    ('<title>Passada</title>', '<title>passada</title>'),
    ('>GPS desligado<', '>Sem sinal<'),
    ('>Pace atual<', '>Ritmo agora<'), ('>Pace médio<', '>Ritmo médio<'),
    ('>Km atual<', '>Este km<'), ('>Ritmo (passos)<', '>Cadência<'), ('>spm<', '>passos/min<'),
    ('<small>Pace</small>', '<small>Ritmo</small>'),
    ('> Aviso por voz a cada km<', '> Avisar por voz a cada km<'),
    ('>Parciais por km<', '>Quilômetros<'),
    ('>Os parciais aparecem a cada quilômetro.<', '>Cada quilômetro aparece aqui.<'),
    ('>INICIAR<', '>Começar<'), ('>PAUSAR<', '>Pausar<'), ('>FINALIZAR<', '>Encerrar<'),
    ('title="Centralizar em mim"', 'title="Voltar para você"'),
])

edit('js/tracker.js', [
    ('`Precisão ±${Math.round(diag.acc)} m: o celular está dando localização APROXIMADA. ` +\n      `Ative "Localização precisa" para este site/navegador nas permissões do celular.`',
     '`A localização está aproximada (±${Math.round(diag.acc)} m). ` +\n      `Ative "Localização precisa" nas permissões do navegador para medir a corrida.`'),
    ('`Leituras: ${diag.recv} · usadas: ${diag.used}`', '`Leituras ${diag.recv} · usadas ${diag.used}`'),
    ("'sinal fraco, ignorada'", "'sinal fraco, descartada'"),
    ("'Permissão de GPS negada'", "'Sem permissão de localização'"), ("'GPS sem sinal'", "'Sem sinal'"), ("'Erro de GPS'", "'Sinal indisponível'"),
    ("'Sem GPS neste aparelho'", "'Este aparelho não tem GPS'"), ("'Procurando GPS…'", "'Procurando sinal…'"),
    ("setGps('ok', `GPS ±${Math.round(accuracy)} m`)", "setGps('ok', `Sinal bom · ±${Math.round(accuracy)} m`)"),
    ("setGps('weak', `GPS ±${Math.round(accuracy)} m`)", "setGps('weak', `Sinal fraco · ±${Math.round(accuracy)} m`)"),
    ("`${km} quilômetro${km > 1 ? 's' : ''}. Parcial ${m} minutos e ${ss} segundos. Pace médio ${am} e ${as}.`",
     "`${km} quilômetro${km > 1 ? 's' : ''}. Esse levou ${m ? m + ' minuto' + (m > 1 ? 's' : '') + ' e ' : ''}${ss} segundo${ss === 1 ? '' : 's'}. Ritmo médio, ${am} e ${String(as).padStart(2, '0')}.`"),
    ("'No ritmo da média'", "'No seu ritmo médio'"),
    ("`${sec}s/km ${diff > 0 ? 'mais rápido' : 'mais lento'} que a média`", "`${sec} s/km ${diff > 0 ? 'mais rápido' : 'mais lento'} que sua média`"),
    ('\'<div class="empty">Os parciais aparecem a cada quilômetro.</div>\'', '\'<div class="empty">Cada quilômetro aparece aqui.</div>\''),
    ("'O trajeto aparece aqui'", "'Seu trajeto aparece aqui'"),
    ('`Há uma corrida não finalizada (${fmtNum(s.distance / 1000, 2)} km). Continuar?`', '`Ficou uma corrida aberta (${fmtNum(s.distance / 1000, 2)} km). Quer continuar de onde parou?`'),
    ("'Finalizar a corrida?'", "'Encerrar a corrida?'"),
    ("'Corrida muito curta (menos de 50 m) — não foi salva.'", "'Corrida curta demais para guardar (menos de 50 m).'"),
    ("'Não consegui salvar a corrida no aparelho.'", "'Não deu para guardar a corrida no aparelho.'"),
    ("state === 'paused' ? 'CONTINUAR' : 'INICIAR'", "state === 'paused' ? 'Continuar' : 'Começar'"),
    ("setGps('', 'GPS desligado')", "setGps('', 'Sem sinal')"),
    ('<th>Km</th><th>Pace</th><th>Acumulado</th>', '<th>Km</th><th>Ritmo</th><th>Tempo total</th>'),
])

edit('js/native.js', [
    ("'Erro: ponte com o Android não carregou (capacitor.js).'", "'Algo não carregou direito. Feche e abra o app de novo.'"),
    ("showErr('Erro no app: ' + e.message)", "showErr('Algo deu errado: ' + e.message)"),
    ("showErr('Erro no app: ' + ((e.reason && e.reason.message) || e.reason))", "showErr('Algo deu errado: ' + ((e.reason && e.reason.message) || e.reason))"),
    ('`GPS ±${Math.round(s.acc)} m · ${s.sats} sat`', "`${s.acc <= 15 ? 'Sinal bom' : 'Sinal fraco'} · ±${Math.round(s.acc)} m`"),
    ("s.gpsOn ? 'Procurando GPS… (fique ao ar livre)' : 'GPS desligado'", "s.gpsOn ? 'Procurando sinal… melhor ao ar livre' : 'Sem sinal'"),
    ('`Satélites em uso: ${s.sats}/${s.satsTotal}`', '`${s.sats} satélites em uso`'),
    ("'Localização precisa', 'Necessária para medir a corrida.'", "'Localização precisa', 'É com ela que a corrida é medida.'"),
    ("'Mostra distância e pace com a tela apagada.'", "'Para ver distância e ritmo com a tela apagada.'"),
    ("'GPS do celular', 'Está desligado.'", "'Localização do celular', 'Está desligada.'"),
    ("'Evita o Android parar a gravação no meio da corrida.'", "'Assim o Android não interrompe a gravação no meio do caminho.'"),
    ('\'<div class="setup-title">Antes de correr</div>\'', '\'<div class="setup-title">Antes de sair</div>\''),
    ("'Sem a permissão de localização o app não consegue medir a corrida.'", "'Sem a localização não dá para medir a corrida. Você pode liberar em Configurações › Apps › passada › Permissões.'"),
    ("'O GPS do celular está desligado. Abrir as configurações para ligar?'", "'A localização do celular está desligada. Abrir as configurações para ligar?'"),
    ("'Não consegui iniciar: '", "'Não deu para começar: '"),
    ("'Finalizar a corrida?'", "'Encerrar a corrida?'"),
    ("'Erro ao finalizar: '", "'Não deu para encerrar: '"),
    ("'Erro: plugin de GPS não respondeu ('", "'A medição não respondeu. Feche e abra o app de novo ('"),
    ('`Há uma corrida não finalizada (${fmtNum(snap.distance / 1000, 2)} km). Continuar?`', '`Ficou uma corrida aberta (${fmtNum(snap.distance / 1000, 2)} km). Quer continuar de onde parou?`'),
])

edit('js/history.js', [
    ('`<h2>Pace por km</h2>', '`<h2>Ritmo por km</h2>'),
    ('>Pace médio</div>', '>Ritmo médio</div>'),
    ('<th>Km</th><th>Pace</th><th>Acumulado</th>', '<th>Km</th><th>Ritmo</th><th>Tempo total</th>'),
    ('`<h2>Parciais</h2>', '`<h2>Quilômetros</h2>'),
    ("'Apagar esta corrida do aparelho? Não dá para desfazer.'", "'Apagar esta corrida? Ela sai do aparelho e não volta.'"),
    ('\'<div class="empty">Nenhuma corrida salva ainda. Finalize uma corrida e ela aparece aqui.</div>\'', '\'<div class="empty">Suas corridas ficam guardadas aqui.</div>\''),
    ('<div><small>Pace</small>', '<div><small>Ritmo</small>'),
])

edit('js/map.js', [('Mapa indisponível', 'O mapa precisa de internet')])
print('ok')
