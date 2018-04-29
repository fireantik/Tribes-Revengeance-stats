const express = require("express");
const winston = require("winston");
const _ = require('lodash');
const sha1 = require('sha1');

const {Player, Server, ServerTrack, Match} = require("./db.js");
const {getChatFor} = require("./chat.js");

let router = express.Router();

function getPlayersForTeam(data, team) {
    return data.fullReport.players
    .filter(p => p.team === team)
    .map(x => {
        const ip = x.ip.split(':')[0];

        return {
            ...x,
            ip: undefined,
            ipHash: ip && sha1(ip),
            ipHashFirstTwo: ip && sha1(ip.split('.')[0] + ip.split('.')[1]),
            ipHashFirstThree: ip && sha1(ip.split('.')[0] + ip.split('.')[1] + ip.split('.')[2]),
            url: '/player/' + x.name
        }
    })
    .sort((a, b) => b.score - a.score)
}

function handleItem(key, player) {
    return {
        value: player[key],
        name: player.name,
        team: player.team
    }
}

function prepareStats(data) {
    const keys = Object.keys(data.fullReport.players[0]).filter(x => [
        'style',
        'defense',
        'offense',
        'deaths',
        'kills',
        'score',
        'team',
        'voice',
        'starttime',
        'ping',
        'name',
        'url',
        'ip'
    ].indexOf(x) === -1);

    const ret = {};
    keys.forEach(k => ret[k] = ({
        max: handleItem(k, _.maxBy(data.fullReport.players, k)),
        min: handleItem(k, _.minBy(data.fullReport.players, k)),
        sum: _.sumBy(data.fullReport.players, k),
        key: k
    }));

    return _.sortBy(_.values(ret).filter(x => x.sum > 0), x => (require('./statorder.json'))[x.key] || "99" + x.key);
}

function generateResultInfo(data) {
    if (parseInt(data.teamonescore) > parseInt(data.teamtwoscore)) {
        return {text: `${data.teamone} won the match!`, team: data.teamone};
    } else if (parseInt(data.teamonescore) < parseInt(data.teamtwoscore)) {
        return {text: `${data.teamtwo} won the match!`, team: data.teamtwo};
    } else {
        return {text: 'Match ended in a tie!'}
    }
}

function getMatchData(id) {

    return Match.where({ _id: id })
    .findOne()
    .exec()
    .then(data => ({
        id: data._id,
        when: data.when,
        result: generateResultInfo(data.basicReport) ,
        info: { ...data.basicReport, players: undefined },
        team1: getPlayersForTeam(data, data.basicReport.teamone),
        team2: getPlayersForTeam(data, data.basicReport.teamtwo),
        stats: prepareStats(data),
    }));
}

router.get('/matches/:id.json', function (req, res, next) {
    return getMatchData(req.params.id).then(data => res.json(data))
});

router.get('/matches/:id', function (req, res, next) {
    return getMatchData(req.params.id).then(data => res.render('match', data))
});

async function getMatchesData(page) {
    const perPage = 10;

    const [data, count] = await Promise.all([
        Match
            .find({ 'basicReport.numplayers': { $ne: '0' }})
            .sort('-when')
            .select({
                basicReport: true,
                when: true
            })
            .skip((page - 1) * perPage)
            .limit(perPage)
            .exec(),
        Match
            .find({ 'basicReport.numplayers': { $ne: '0' }})
            .count()
            .exec()
    ]);

    const lastPage = Math.floor(count / perPage) + 1;

    return {
        matches: data.map(m => ({
            id: m._id,
            when: m.when,
            map: m.basicReport.mapname,
            hostname: m.basicReport.hostname,
            teamone: m.basicReport.teamone,
            teamonescore: m.basicReport.teamonescore,
            teamtwo: m.basicReport.teamtwo,
            teamtwoscore: m.basicReport.teamtwoscore,
            gametype: m.basicReport.gametype,
            numplayers: m.basicReport.numplayers,
        })),
        pagination: {
            page,
            perPage,
            count: count,
            first: 1,
            last: lastPage,
            prev: page - 1 >= 1 ? page - 1 : null,
            next: page + 1 <= lastPage ? page + 1 : null,
        }
    };
}

function parsePage(page) {
    try {
        return parseInt(page || 1);
    } catch (ex) {
        return 1;
    }
}

router.get('/matches.json', function (req, res, next) {
    return getMatchesData(parsePage(req.query.page))
    .then(data => res.json(data))
});

router.get('/matches', function (req, res, next) {
    return getMatchesData(parsePage(req.query.page))
    .then(data => res.render('matches', data))
});

module.exports = {
    router
}
