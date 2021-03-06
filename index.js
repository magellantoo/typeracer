#!/usr/bin/env node

const chalk = require('chalk')
const draftLog = require('draftlog')
const fuzzy = require('fuzzy')
const homeDir = require('home-dir')
const inquirer = require('inquirer')
const low = require('lowdb')
const FileSync = require('lowdb/adapters/FileSync')
const quotes = require('./quotes').quotes

const adapter = new FileSync(`${homeDir()}/typeracer-records.json`)
const db = low(adapter)

db.defaults({records: []})
	.write()

const stdin = process.stdin
const stdout = process.stdout
stdin.setRawMode(true)
draftLog(console)
inquirer.registerPrompt('autocomplete', require('inquirer-autocomplete-prompt'))

// draftlog cant update if the string is more than one line,
// so we split the quotes into lines of 50 char per line.
// feel free to change this value.
const MAX_WORDS_PER_LINE = 12

let quoteStrings = []
let userString = []

let timeStarted
let finished = false
let onMistake = false
let wpm = 0
let time = -2
let typeMistakes = 0

let updateStrings = []
let updateWpm
let updateTime
let updateAcc

let prevQuoteID

const allQuotes = []
for (const obj of quotes) {
	allQuotes.push(obj.quote)
}

stdout.write('\u001B[2J\u001B[0;0f')
main()

function main() {
	inquirer.prompt({
		type: 'list',
		name: 'whatdo',
		message: 'What do you want to do?',
		choices: [
			'Random quote',
			'Pick quote',
			'Exit'
		]
	}).then(answer => {
		stdout.write('\u001B[2J\u001B[0;0f')
		switch (answer.whatdo) {
			case 'Random quote':
				play(Math.ceil(Math.random() * quotes.length))
				break
			case 'Pick quote':
				pickQuote()
				break
			case 'Exit':
				process.exit()
				break
		}
	}).catch(err => {
		console.log(err)
	})
}

function pickQuote() {
	inquirer.prompt({
		type: 'autocomplete',
		name: 'whatQuote',
		message: 'Pick quote',
		source: (answersSoFar, input) => {
			input = input || ''
			return new Promise(resolve => {
				setTimeout(() => {
					const fuzzyResult = fuzzy.filter(input, allQuotes)
					resolve(fuzzyResult.map(el => {
						return el.original
					}))
				}, 100)
			})
		}
	}).then(answers => {
		stdout.write('\u001B[2J\u001B[0;0f')
		play(allQuotes.indexOf(answers.whatQuote) + 1)
	})
}

function play(quoteID) {
	prevQuoteID = quoteID

	quoteStrings = []
	userString = []

	timeStarted = Date.now() + 2000
	finished = false
	onMistake = false
	wpm = 0
	time = -2
	typeMistakes = 0

	updateStrings = []

	const quoteString = quotes[quoteID - 1].quote.split(' ')
	for (let i = 0; i < quoteString.length; i += MAX_WORDS_PER_LINE) {
		let line = quoteString.slice(i, i + MAX_WORDS_PER_LINE).join(' ')
		// add space at end of line
		if (!(i + MAX_WORDS_PER_LINE > quoteString.length - 1)) line += ' '
		quoteStrings.push(line)
		updateStrings.push(console.draft(line))
	}

	console.log('') // empty line for spacing

	updateWpm = console.draft('wpm: ')
	updateTime = console.draft('time: ')
	updateAcc = console.draft('acc: ')

	console.log('') // empty line for spacing

	stdin.on('keypress', onKeypress)
	stdin.setRawMode(true)
	stdin.resume()

	const interval = setInterval(() => {
		if (!finished) {
			time = (Date.now() - timeStarted) / 1000
			if (userString.length > 0) wpm = userString.join('').split(' ').length / (time / 60)

			let acc = 100
			if (typeMistakes !== 0) {
				acc = Math.round(((userString.length - typeMistakes) / userString.length) * 1000) / 10
			}

			let timeColour = 'white'
			if (time < -1) timeColour = 'red'
			else if (time < 0) timeColour = 'yellow'
			else if (time < 1) timeColour = 'green'

			updateWpm('wpm: ' + (Math.round(wpm * 10) / 10))
			updateTime('time: ' + chalk[timeColour](Math.round(time * 10) / 10) + 's')
			updateAcc('acc: ' + acc + '%')
		} else {
			clearInterval(interval)
		}
	}, 100)
}

function onKeypress(ch, key) {
	// listen for CTRL^C
	if (key && key.ctrl && key.name === 'c') {
		stdout.write('\u001B[2J\u001B[0;0f')
		process.exit()
	}

	if (time < 0) return
	if (key && key.name === 'backspace') {
		if (userString.length === 0) return
		userString.pop()
	} else {
		if (userString.length < quoteStrings.join('').length) userString.push(ch)
	}

	let countedMistakes = 0

	let updatedString = quoteStrings.join('').split('')
	for (let i = 0; i < userString.length; i++) {
		if (userString[i] === updatedString[i]) {
			if (countedMistakes > 0) updatedString[i] = chalk.bgRed(updatedString[i])
			else updatedString[i] = chalk.blue(updatedString[i])
		} else {
			updatedString[i] = chalk.bgRed(updatedString[i])
			countedMistakes++
			if (!onMistake) {
				onMistake = true
				typeMistakes++
			}
		}
	}

	if (countedMistakes === 0) onMistake = false

	updatedString = updatedString.join('').split(' ')
	for (let i = 0; i < updatedString.length - 1; i += MAX_WORDS_PER_LINE) {
		let line = updatedString.slice(i, i + MAX_WORDS_PER_LINE).join(' ')
		updateStrings[i / MAX_WORDS_PER_LINE](line)
	}

	if (userString.join('') === quoteStrings.join('')) {
		finished = true
		stdin.removeListener('keypress', onKeypress)

		wpm = Math.round(wpm * 100) / 100 // 2 decimals
		// handle records
		const prevRecord = db.get('records')
			.find({id: prevQuoteID})
			.value()

		// also log description of quote
		console.log(chalk.inverse(quotes[prevQuoteID - 1].about + '\n'))

		if (!prevRecord) {
			// no record has been previously set
			console.log(chalk.yellow('Set first time record of ') + wpm + 'wpm\n')

			db.get('records')
				.push({id: prevQuoteID, wpm: wpm})
				.write()
		} else {
			// new record
			if (wpm > prevRecord.wpm) {
				const difference = Math.round((wpm - prevRecord.wpm) * 100) / 100
				console.log(chalk.magenta('New record! ') + wpm + 'wpm' + chalk.green('+' + difference) + '\n')

				db.get('records')
					.find({id: prevQuoteID})
					.assign({wpm: wpm})
					.write()
			}
		}

		inquirer.prompt({
			type: 'list',
			name: 'whatdo',
			message: 'What do you want to do?',
			choices: [
				'Retry',
				'Go back'
			]
		}).then(answer => {
			stdout.write('\u001B[2J\u001B[0;0f')
			switch (answer.whatdo) {
				case 'Retry':
					play(prevQuoteID)
					break
				case 'Go back':
					main()
					break
			}
		})
	}
}
