# passada — identidade

## Essência
Um app de corrida que mede bem e fala pouco. Não torce, não cobra, não exagera: mostra o que aconteceu, com precisão, e sai da frente.
**Frase:** *Corra do seu jeito. A medida fica com a gente.*

## Tom de voz: neutro e natural
- Frases curtas, em português do dia a dia, falando com "você".
- Sem exclamação, sem emoji, sem "incrível", "arrasou", "bora". Nada de motivação forçada.
- Informar o fato, não julgar: "8 s/km mais lento que sua média", nunca "você está devagar".
- Números primeiro, palavras depois. Unidade sempre junto (km, /km, km/h).
- "Ritmo" no lugar de "pace" (é o que se fala na rua). "Encerrar" no lugar de "finalizar".
- Erros dizem o que fazer: "O GPS está desligado. Ligue nas configurações do celular."

| Situação | Assim | Não assim |
|---|---|---|
| Botão principal | Começar · Pausar · Continuar · Encerrar | INICIAR CORRIDA AGORA! |
| Sinal | Procurando sinal… · Sinal bom · ±5 m | GPS LOCKED |
| Voz a cada km | "Dois quilômetros. Esse levou cinco minutos e três segundos. Ritmo médio, cinco e um." | "Parabéns, mais um km!" |
| Lista vazia | Suas corridas ficam guardadas aqui. | Nenhum dado encontrado. |

## Cores (natureza, luz baixa)
| Papel | Nome | Hex |
|---|---|---|
| Fundo | Carvão | `#131311` |
| Superfície | Pedra | `#1C1B18` |
| Linha | Cascalho | `#2C2A26` |
| Texto | Areia | `#EEECE6` |
| Texto secundário | Folha seca | `#9B978D` |
| Destaque (trajeto, ritmo, começar) | Sálvia | `#A3C48A` |
| Atenção (pausar, sinal fraco) | Ocre | `#D8A85A` |
| Encerrar / erro | Terracota | `#CF6F55` |
| Você no mapa | Céu | `#8FB7D9` |

Regras: fundo sempre escuro e quente (lê bem no sol e não ofusca à noite); só um destaque por tela; sem gradiente forte, sem brilho, sem animação contínua.

## Tipografia
Fonte do sistema (Roboto no Android), números tabulares. Números grandes em peso 700; rótulos pequenos em maiúsculas espaçadas, cor Folha seca. O nome sempre em minúsculas: **passada**.

## Marca
Um traço que sobe em curva suave e termina num ponto: o caminho feito e onde você está agora. Sálvia sobre carvão. O ponto de partida é um pequeno círculo em areia.
Arquivos: `icon.svg` (app e web), `android/app/src/main/res/drawable/ic_launcher_fg.xml` (ícone Android), `ic_stat_run.xml` (notificação).
