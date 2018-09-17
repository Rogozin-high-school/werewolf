const websocket = require("ws");
const http = require("http");
const fs = require("fs");
const path = require("path");

const wss = new websocket.Server({ port: 8080 });

const electron_build = true;

if (electron_build) {
    const {app, BrowserWindow, globalShortcut} = require("electron");
    app.on("ready", function() {
        setTimeout(function() {
            win = new BrowserWindow({width: 800, height: 600});
            win.loadFile("host.html");
            // win.setMenu(null);
            globalShortcut.register("CommandOrControl+f5", function() {
                win.reload();
            });
            win.on("close", function() {
                wss.close();
                https.close();
                app.quit();
            });
        }, 1500);
    });
}

var IP_ADDR = require("ip").address();

function dict() {
    di = {};
    for (var i = 0; i < arguments.length; i++) {
        di[arguments[i][0]] = arguments[i][1];
    }
    return di;
}

function listify(d) {
    var res = [];
    for (var x in d) if (d.hasOwnProperty(x)) {
        res.push([x, d[x]]);
    }
    return res;
}

function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function log(c) {
    console.log(c);
    send_host({type: "log", log: c});
}

function speak(c) {
    send_host({type: "speak", message: c});
}

function send_roles() {
    for (var x in players) if (players.hasOwnProperty(x)) {
        sockets[x].send(JSON.stringify({type: "role", role: players[x].role}));
    }
}

function check_cultists() {
    var cultist = pcount(x => x.role == Role.CULTIST);
    console.log("Cultists left: " + cultist.toString());
    if (!cultist) {
        for (var i in players) if (players.hasOwnProperty(i)) {
            console.log(JSON.stringify(players[i]));
            if (players[i].role == Role.CULT_MEMBER && players[i].alive) {
                players[i].role = Role.CULTIST;
                break;
            }
        }
    }
}

var players = { };
var sockets = { };
var round = 1;
var night_index = -1;
var night_players = [];
var in_game = false;
var host_socket = null;
var spectator_socket = null;
var nights_no_killing = 0;

var Role = {
    VILLAGER: 0,
    VETERAN: 1,
    WITCH: 2,
    JESTER: 3,
    WEREWOLF: 4,
    HEALER: 5,
    FORTUNE_TELLER: 6,
    PRIEST: 7,
    ARSONIST: 8,
    PROPHET: 9,
    MINION: 10,
    CULTIST: 11,
    CULT_MEMBER: 12
};

var Aura = {
    GOOD: 1,
    BAD: 2,
    NEUTRAL: 0,
    CHAOTIC: 3
}

var RoleNames = dict(
    [Role.VILLAGER, "Villager"],
    [Role.VETERAN, "Veteran"],
    [Role.WITCH, "Witch"],
    [Role.JESTER, "Jester"],
    [Role.WEREWOLF, "Werewolves"],
    [Role.HEALER, "Healer"],
    [Role.FORTUNE_TELLER, "Fortune teller"],
    [Role.PRIEST, "Priest"],
    [Role.ARSONIST, "Arsonist"],
    [Role.PROPHET, "Prophet"],
    [Role.MINION, "Minion"],
    [Role.CULTIST, "Cultist"],
    [Role.CULT_MEMBER, "Cult member"]
);

var Distribution = dict(
    [Role.VILLAGER, 0],
    [Role.VETERAN, 1],
    [Role.WITCH, 1],
    [Role.JESTER, 1],
    [Role.WEREWOLF, 2],
    [Role.HEALER, 1],
    [Role.FORTUNE_TELLER, 1],
    [Role.PRIEST, 1],
    [Role.ARSONIST, 1],
    [Role.PROPHET, 1],
    [Role.MINION, 1]
);

var Sides = dict(
    [Role.VILLAGER, Aura.GOOD],
    [Role.WITCH, Aura.CHAOTIC],
    [Role.JESTER, Aura.NEUTRAL],
    [Role.WEREWOLF, Aura.BAD],
    [Role.HEALER, Aura.GOOD],
    [Role.FORTUNE_TELLER, Aura.GOOD],
    [Role.PRIEST, Aura.GOOD],
    [Role.ARSONIST, Aura.CHAOTIC],
    [Role.VETERAN, Aura.GOOD],
    [Role.PROPHET, Aura.GOOD],
    [Role.MINION, Aura.BAD],
    [Role.SACRIFIER, Aura.GOOD],
    [Role.CULTIST, Aura.CHAOTIC],
    [Role.CULT_MEMBER, Aura.CHAOTIC]
);

var Observations = dict(
    [Role.VILLAGER, Aura.GOOD],
    [Role.WITCH, Aura.BAD],
    [Role.JESTER, Aura.GOOD],
    [Role.WEREWOLF, Aura.BAD],
    [Role.HEALER, Aura.GOOD],
    [Role.FORTUNE_TELLER, Aura.GOOD],
    [Role.PRIEST, Aura.GOOD],
    [Role.ARSONIST, Aura.GOOD],
    [Role.VETERAN, Aura.BAD],
    [Role.PROPHET, Aura.GOOD],
    [Role.MINION, Aura.GOOD],
    [Role.SACRIFIER, Aura.GOOD],
    [Role.CULTIST, Aura.BAD],
    [Role.CULT_MEMBER, Aura.BAD]
);

var NightOrder = [
    Role.VETERAN,
    Role.WITCH,
    Role.CULTIST,
    Role.JESTER,
    Role.WEREWOLF,
    Role.MINION,
    Role.HEALER,
    Role.FORTUNE_TELLER,
    Role.PRIEST,
    Role.ARSONIST
];

var FirstNightCallouts = dict(
    [Role.CULTIST, "Cult, wake up. You can convert a player every odd night, and they will join the cult. Who would you like to convert?"],
    [Role.WITCH, "Witch, wake up. Pick your target to cast a spell on, then pick their target. They will use their ability on your chosen target instead of their target of choice."],
    [Role.JESTER, "Jester, wake up. Pick one player to kill immediately."],
    [Role.VETERAN, "Veteran, wake up. In three nights of the game, you can stay on alert. If you're on alert, every player stepping into your house will be killed. Would you like to stay on alert?"],
    [Role.WEREWOLF, "Werewolves, wake up. Together, pick a player to kill."],
    [Role.MINION, "Minion, wake up. Werewolves, raise your hands so the minion sees you. Minion, your goal is keeping those alive."],
    [Role.HEALER, "Healer, wake up. Choose one player to heal. If they were attacked, they will not be killed"],
    [Role.FORTUNE_TELLER, "Fortune teller, wake up. Choose a player to look at their aura. You will see if they're good or bad."],
    [Role.PRIEST, "Priest, wake up. You can kill one player in the whole game. If you kill a player with a good aura, you die, too."],
    [Role.ARSONIST, "Arsonist, wake up. You can douse a player every night, then ignite all doused players at one."],
    [Role.PROPHET, "Prophet, wake up. You can choose a role and receive a hint about the players holding that role."]
);

var Callouts = dict(
    [Role.CULTIST, "Cult, wake up. Who would you like to convert?"],
    [Role.WITCH, "Witch, wake up. Who would you like to cast your spell on?"],
    [Role.JESTER, "Jester, wake up. Who would you like to kill?"],
    [Role.VETERAN, "Veteran, wake up. Would you like to stay on alert?"],
    [Role.WEREWOLF, "Werewolves, wake up. Who would you like to kill?"],
    [Role.HEALER, "Healer, wake up. Who would you like to heal?"],
    [Role.FORTUNE_TELLER, "Fortune teller, wake up. Who would you like to observe?"],
    [Role.PRIEST, "Priest, wake up. Would you like to kill someone?"],
    [Role.ARSONIST, "Arsonist, wake up. Who would you like to douse?"],
    [Role.PROPHET, "Prophet, wake up. Which role would you like to pray for?"]
);


var Action = dict(
    [Role.WITCH, function(player, target) {
		if (target.constructor.name == "Array") {
			players[target[0]].witch_target = target[1];
		}
    }],
    [Role.JESTER, function(player, target) {
        if (target) {
            players[target].health -= 1;
            players[target].death.push("a Jester");
        }
    }],
    [Role.WEREWOLF, function(player, target) {
        if (target) {
            players[target].health -= 1;
            players[target].death.push("the Werewolves");
        }
    }],
    [Role.HEALER, function(player, target) {
        if (target) {
            players[target].health += 1.1;
        }
    }],
    [Role.FORTUNE_TELLER, function(player, target) {
        return;
    }],
    [Role.PRIEST, function(player, target) {
        if (!target) { 
            return;
        }
        players[target].health -= 1;
        players[target].death.push("a Priest");
        players[player].priest_used = true;
        if (Sides[players[target].role] == Aura.GOOD) {
            players[player].health -= 1;
            players[player].death.push("Divine Power");
        }
    }],
    [Role.ARSONIST, function(player, target) {
        if (target) {
            players[target].fuel = true;
        }
        else {
            for (var i in players) if (players.hasOwnProperty(i)) {
                if (players[i].fuel) {
                    players[i].health -= 1;
                    players[i].death.push("Fire");
                }
            }
        }
    }],
    [Role.PROPHET, function(player, role) {
        if (!Object.values(players).some(x => x.role == role && x.alive)) {
            return null;
        }
        pl = [];
        for (var i in players) if (players.hasOwnProperty(i)) if (players[i].alive) {
            pl.push([i, players[i].name, players[i].role]);
        }
        shuffle(pl);
        pl.sort((x, y) => x[2] == role ? -1 : 1);
        pl = pl.slice(0, 3);
        shuffle(pl);
    }],
    [Role.VETERAN, function(player, al) {
        if (!players[player].alerts && players[player].alerts != 0) {
            players[player].alerts = 3;
        }

        if (players[player].alerts && al) {
            players[player].alert = true;
            players[player].alerts -= 1;
        }
    }],
    [Role.MINION, function() {}],
    [Role.CULTIST, function(player, target) {
        if (!target) return;
        
        if (players[target].role == Role.WITCH || players[target].role == Role.CULT_MEMBER || players[target].role == Role.CULTIST || Sides[players[target].role] == Aura.GOOD) {
            players[target].role = Role.CULT_MEMBER;
        }
        else {
            players[target].health -= 1;
            players[target].death.push("a Cultist");
        }

        for (var x in players) if (players.hasOwnProperty(x)) {
            sockets[x].send(JSON.stringify({type: "role", role: players[x].role}));
        }
    }]
);

function init_game() {
    for (var i in players) if (players.hasOwnProperty(i)) {
        players[i] = {name: players[i].name, alive: true, jester: false};
    }

    var roles = [];
    for (var i in Distribution) if (Distribution.hasOwnProperty(i)) {
        for (var x = 0; x < Distribution[i]; x++) roles.push(i);
    }

    if (roles.length != Object.values(players).length) {
        return "Player number mismatching with roles number";
    }

    shuffle(roles);
    var i = 0;
    for (var x in players) if (players.hasOwnProperty(x)) {
        players[x].role = parseInt(roles[i++]);
    }

    round = 1;
    in_game = true;
    nights_no_killing = 0;
    return true;
}

function start_night() {
    for (var i in players) if (players.hasOwnProperty(i)) {
        players[i].witch_target = null;
        players[i].alert = null;
        players[i].health = 0;
        players[i].death = [];
    }

    night_index = 0;
    
    send_all({type: "nightfall"})
    speak("Good night, village.");
}

function night_move() {
    night_players = active_players(NightOrder[night_index]);
    log("Looking for " + RoleNames[NightOrder[night_index]]);
    // while (night_players.length == 0 && night_index++ < NightOrder.length) {
    //     night_players = active_players(NightOrder[night_index]);
    //     log("Looking for " + RoleNames[NightOrder[night_index]]);
    // }
    console.log(NightOrder[night_index] + ": " + Role.JESTER);
    if (night_players.length == 0 && night_index < NightOrder.length) {
        if (NightOrder[night_index] == Role.JESTER || NightOrder[night_index] == Role.MINION) {
            night_index++;
            setTimeout(night_move, 1);
            return;
        }
        speak(round == 1 ? Callouts[NightOrder[night_index]] : Callouts[NightOrder[night_index]]);
        setTimeout(function() {
            speak("Good night, " + RoleNames[NightOrder[night_index]]);
            night_index++;
            setTimeout(night_move, 3000);
        }, Math.random() * 10000 + 1000);
        return;
    }

    
    if (night_index >= NightOrder.length) {
        log("Ending night");
        result = end_night();

        if (nights_no_killing == 3) {
            end_game("DRAW");
            return;
        }
        if (check_win()) {
            return;
        }

        log("Night ended with result: " + result);
        send_host({type: "sunrise", data: result, players: living_player_list()});
        update_spectator();
        setTimeout(function() {
            speak("Good morning, village.");
            setTimeout(function() {
                speak(result.join(".").replace(/<(?:.|\n)*?>/gm, ''));
            }, 3000);
        }, 1000);
    }
    else {
        log("Calling next role: " + RoleNames[NightOrder[night_index]]);
        speak(round == 1 ? Callouts[NightOrder[night_index]] : Callouts[NightOrder[night_index]]);
    }

    setTimeout(function() {
        if (NightOrder[night_index] == Role.WEREWOLF) {
            var plyr = null;
            for (var i = 0; i < night_players.length; i++) {
                if (players[night_players[i]].witch_target) {
                    plyr = night_players[i];
                }
            }
            if (!plyr) {
                plyr = night_players[0];
            }
            sockets[plyr].send(JSON.stringify({type: "action", players: living_player_list()}));
        }
        else {
            for (var i = 0; i < night_players.length; i++) {
                sockets[night_players[i]].send(JSON.stringify({type: "action", players: living_player_list()}));
            }
        }
    }, 1500);
}

function make_move(player, data) {
    
    if (~night_players.indexOf(player)) {
        
        if (players[data] && players[player].witch_target) {
            data = players[player].witch_target;
        }
        if (players[data] && players[data].alert) {
            players[player].health -= 1;
            players[player].death.push("a Veteran");
        }
        else {
            var res = Action[players[player].role](player, data);
        }

        sockets[player].send(JSON.stringify({type: "end_action", data: res}));

        night_players = night_players.filter(x => x != player);
        if (night_players.length == 0 || NightOrder[night_index] == Role.WEREWOLF) {
            speak("Good night, " + RoleNames[NightOrder[night_index]]);
            night_index++;
            setTimeout(night_move, 3000);
        }

    }

}

function list(m) {
    arr = m.slice()
    var last = arr.pop();
    if (arr.length == 0) {
        return last;
    }
    return arr.join(', ') + ' and ' + last;
}

function end_night() {

    round++;
    night_index = -1;
    var killed = 0;

    var s = [];
    for (var i in players) if (players.hasOwnProperty(i)) {
        if (players[i].health < 0 && players[i].alive) {
            log(players[i].death);
            s.push("<b>" + players[i].name + "</b> was killed by " + list(players[i].death));
            players[i].alive = false;
            killed++;
            sockets[i].send(JSON.stringify({type: "death"}));
        }
        else if (players[i].alive && players[i].health >= 0 && players[i].death.length > 0) {
            s.push("<b>" + players[i].name + "</b> was saved from " + list(players[i].death));
        }
    }

    check_cultists();

    for (var x in players) if (players.hasOwnProperty(x)) {
        if (!sockets[x] || sockets[x].readyState != sockets[x].OPEN) {
            delete players[x];
        }
    }
    
    if (killed == 0) {
        nights_no_killing++;
    }
    else {
        nights_no_killing = 0;
    }


    send_roles();
    return s;
}

function execute(player) {
    players[player].alive = false;
    nights_no_killing = 0;
    if (players[player].role == Role.JESTER) {
        players[player].jester = true;
        players[player].winner = true;
    }
    else {
        sockets[player].send(JSON.stringify({type: "death"}));
    }

    check_cultists();
}

function active_players(role) {
    var pl = [];
    for (var x in players) if (players.hasOwnProperty(x)) {
        if (players[x].role == role) {
            if (players[x].role == Role.JESTER) {
                if (players[x].jester == true) {
                    console.log(JSON.stringify(players[x]));
                    players[x].jester = false;
                    pl.push(x);
                }
                continue;
            }
            if (!players[x].alive) {
                continue;
            }
            if (players[x].role == Role.MINION) {
                if (round == 1) {
                    pl.push(x);
                }
            }
            else if (players[x].role == Role.PRIEST) {
                if (!players[x].priest_used) {
                    pl.push(x);
                }
            }
            else if (players[x].role == Role.VETERAN) {
                if (players[x].alerts != 0) {
                    pl.push(x);
                }
            }
            else {
                pl.push(x);
            }
        }
    }
    console.log(JSON.stringify())
    return pl;
}

function player_list() {
    pl = [];
    for (var x in players) if (players.hasOwnProperty(x)) {
        pl.push([x, players[x].name]);
    }
    return pl;
}

function living_player_list() {
    pl = [];
    for (var x in players) if (players.hasOwnProperty(x) && players[x].alive) {
        pl.push([x, players[x].name]);
    }
    return pl;
}

function send_host(msg) {
    if (host_socket && host_socket.readyState == host_socket.OPEN) {
        host_socket.send(JSON.stringify(msg));
    }
    else {
        console.log(host_socket && host_socket.readyState);
    }
}

function send_all(msg) {
    for (var i in sockets) if (sockets.hasOwnProperty(i)) {
        if (sockets[i].readyState == sockets[i].OPEN) {
            sockets[i].send(JSON.stringify(msg));
        }
    }
}

function update_spectator() {
    if (spectator_socket && spectator_socket.readyState == spectator_socket.OPEN) {
        spectator_socket.send(JSON.stringify({type: "spectator", data: players}));
    }
}

function pcount(l) {
    return listify(players).filter(x => x[1].alive && l(x[1])).length;
}

function get_winning_team() {
    var ps = players.length;
    var good = pcount(x => Sides[x.role] == Aura.GOOD);
    var jesters = pcount(x => x.role == Role.JESTER);
    var village = good + jesters;
    var werewolves = pcount(x => x.role == Role.WEREWOLF);
    var witch = pcount(x => x.role == Role.WITCH);
    var arso = pcount(x => x.role == Role.ARSONIST);
    var pls = pcount(x => true);
    var healers = pcount(x => x.role == Role.HEALER);
    var cult = pcount(x => x.role == Role.CULTIST || x.role == Role.CULT_MEMBER);
    console.log("cult members: " + cult.toString());
    if (pls == 0) {
        return "DRAW";
    }
    
    if (!werewolves && !arso && !cult && good) {
        return "VILLAGE";
    }

    if (witch && !good && !arso && !werewolves && !cult) {
        return "WITCH";
    }

    if (ps == 2 && werewolves == 1 && village == 1 && healers == 1) {
        return ["WEREWOLVES", "VILLAGE"];
    }
    
    if (werewolves && !arso && !witch && !good && !cult) {
        return "WEREWOLVES";
    }

    if (witch && !werewolves && !arso && !good && !cult) {
        return "WITCH";
    }

    if (!good && !werewolves && !arso && cult) {
        return "CULT";
    }

    if (arso && !witch && !werewolves && !good && !cult) {
        return "ARSO";
    }

    if (arso == 1 && witch == 1 && !werewolves && !good) {
        return "WITCH";
    }

    return null;
}

function belongs(player, team) {
    if (Sides[player.role] == Aura.GOOD && (team == "VILLAGE" || ~team.indexOf("VILLAGE"))) {
        return true;
    }
    if (Sides[player.role] == Aura.BAD && (team == "WEREWOLVES" || ~team.indexOf("WEREWOLVES"))) {
        return true;
    }
    if (player.role == Role.ARSONIST && (team == "ARSO" || ~team.indexOf("ARSO"))) {
        return true;
    }
    if (player.role == Role.WITCH && (team == "WITCH" || team == "CULT" || ~team.indexOf("WITCH"))) {
        return true;
    }
    if ((player.role == Role.CULT_MEMBER || player.role == Role.CULTIST) && (team == "WITCH" || team == "CULT")) {
        return true;
    }
    return false;
}

function end_game(winner) {
    var winners = listify(players).filter(x => belongs(x[1], winner) || x.winner);
    setTimeout(function() {
        send_host({type: "victory", team: winner, winners: winners});
    }, 3000);
    in_game = false;
}

function check_win() {
    var a = get_winning_team();
    if (a) {
        end_game(a);
    }
}

var getUniqueID = function () {
    function s4() {
        return Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
    }
    return s4() + s4() + '-' + s4();
};

wss.on("connection", function(ws) {

    ws.id = getUniqueID();
    sockets[ws.id] = ws;

    ws.on("message", function(msg) {
        var j = JSON.parse(msg);
        if (handlers[j.type]) {
            handlers[j.type](ws, j);
        }
    });

    ws.on("close", function() {
        delete players[ws.id];
        delete sockets[ws.id];
        if (in_game) {
            send_host({type: "living_players", players: living_player_list()});
        } else {
            send_host({type: "player_list", players: player_list()});
        }
    });
});

var handlers = {
    name_edit: function(ws, msg) {
        if (in_game) {
            return;
        }
        players[ws.id] = { };
        players[ws.id].name = msg.name || 
            ((["Michael", "Gina", "Laurie", "Sally", "Barack", "William", "Stanley", "Corey", "Samantha", "Lucas"])[Math.floor(Math.random()*10)] + " " + (["Giles", "Cohen", "Levi", "Smith", "Brown", "Trump", "Bin Laden", "Rotschield", "Grimberg", "Stein"])[Math.floor(Math.random()*10)]);
        log(players);
        send_host({type: "player_list", players: player_list()});
        update_spectator();
    },
    game_start: function(ws, msg) {
        log("Starting game");
        Distribution = msg.distribution;
        NightOrder = msg.nightorder;

        var res = init_game();
        if (res != true) {
            in_game = false;
            log("Game start error: " + res);
            return;
        }
        send_roles();

        send_all({type: "game_start"});
        send_host({type: "living_players", players: living_player_list()});
        update_spectator();
    },
    game_stop: function(ws, msg) {
        in_game = false;
        for (var x in players) if (players.hasOwnProperty(x)) {
            sockets[x].send(JSON.stringify({type: "game_end"}));
        }
    },
    distribution: function(ws, msg) {

    },
    night_start: function(ws, msg) {
        start_night();
        setTimeout(night_move, 3000);
    },
    set_host: function(ws, msg) {
        log("Updated host socket");
        host_socket = ws;
        in_game = false;
        send_all({type: "reset"});
        send_host({type: "player_list", players: player_list()});
        send_host({type: "ip", ip: IP_ADDR});
    },
    spectator: function(ws, msg) {
        spectator_socket = ws;
    },
    night_action: function(ws, msg) {
        log("Making move: " + JSON.stringify(msg));
        make_move(ws.id, msg.data);
    },
    tell_fortune: function(ws, msg) {
        if (players[ws.id].witch_target) {
            msg.data = players[ws.id].witch_target;
        }
        if (players[msg.data] && players[msg.data].alert) {
            players[ws.id].health -= 1;
            players[ws.id].death.push("a Veteran");
        }
        ws.send(JSON.stringify({type: "fortune", data: Observations[players[msg.data].role], player: players[msg.data].name}));
    },
    execute: function(ws, msg) {
        log("Executing player " + JSON.stringify(msg));
        execute(msg.data);
        log("Executed player: " + JSON.stringify(players[msg.data]));
        send_host({type: "living_players", players: living_player_list()});
        update_spectator();
        check_win();
    },
    kick: function(ws, msg) {
        if (sockets[msg.data]) {
            sockets[msg.data].close();
            delete sockets[msg.data];
        }
        delete players[msg.data];
        update_spectator();
        send_host({type: "player_list", players: player_list()});
    }
}
console.log("Running http");
var https = http.createServer(function(request, response) {
    var file = request.url;

    var filepath = path.resolve("index.html");
    var mime = "text/html";

    if (file == "/spectator") {
        filepath = path.resolve("spectator.html");
    }
    else if (file == "/host") {
        filepath = path.resolve("host.html");
    }
    else if (file.endsWith(".mp3")) {
        filepath = file.substring(1);
        mime = path.resolve("audio/mpeg");
    }
    else if (file == "/jquery.js") {
        filepath = path.resolve("jquery.js");
        mime = "text/javascript";
    }
    else if (file.endsWith(".png")) {
        filepath = path.resolve(file.substring(1));
        mime = path.resolve("image/png");
    }
    
    console.log("Reading file : " + filepath + " (from string " + file + ")");
    fs.readFile(filepath, function(err, content) {
        if (err) {
            response.writeHead(404);
            response.end("Sorry, the resource was not found on the server");
            response.end();
        }
        else {
            response.writeHead(200, {"Content-Type": mime});
            response.end(content, "utf-8");
            response.end();
        }
    });
});
https.listen(80);