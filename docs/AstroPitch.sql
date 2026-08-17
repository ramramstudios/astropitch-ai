-- phpMyAdmin SQL Dump
-- version 4.9.7
-- https://www.phpmyadmin.net/
--
-- Host: localhost:8889
-- Generation Time: May 02, 2021 at 08:06 PM
-- Server version: 5.7.32
-- PHP Version: 7.4.12

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

CREATE TABLE `Ascendant` (
  `ascID` int(3) NOT NULL,
  `zodiacID` int(3) NOT NULL,
  `houseID` int(3) NOT NULL,
  `ascDesc` varchar(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

INSERT INTO `Ascendant` (`ascID`, `zodiacID`, `houseID`, `ascDesc`) VALUES
(1, 1, 1, ''),
(5, 5, 1, '@christopherstrickland66');

CREATE TABLE `House` (
  `houseID` int(2) NOT NULL,
  `meaning` varchar(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

INSERT INTO `House` (`houseID`, `meaning`) VALUES
(1, '1st house: ego, sense of self'),
(2, '2nd house: material posessions and security'),
(3, '3rd house: local community, communication'),
(4, '4th house: home and family'),
(5, '5th house: creativity and romance'),
(6, '6th house: day jobs, routines, health'),
(7, '7th house: partnerships'),
(8, '8th house: death, sex, transformation'),
(9, '9th house: travel, philosophy'),
(10, '10th house: public image, career, legacy'),
(11, '11th house: humanity, technology'),
(12, '12th house: collective unconscious, psychic abilities');

CREATE TABLE `Moon` (
  `moonID` int(3) NOT NULL,
  `zodiacID` int(3) DEFAULT NULL,
  `houseID` int(3) DEFAULT NULL,
  `moonDesc` varchar(255) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

INSERT INTO `Moon` (`moonID`, `zodiacID`, `houseID`, `moonDesc`) VALUES
(1, 1, 1, 'The moon rules your emotions, moods, and feelings. This field describes what it means to have your moon in ARIES and also in your first house '),
(2, 2, 1, 'The moon rules your emotions, moods, and feelings. This field describes what it means to have your moon in TAURUS and also in your first house '),
(3, 3, 1, 'The moon rules your emotions, moods, and feelings. This field describes what it means to have your moon in GEMINI and also in your first house '),
(4, 4, 1, NULL),
(5, 5, 1, NULL),
(6, 6, 1, '@christopherstrickland66'),
(7, 7, 1, NULL),
(8, 8, 1, NULL),
(9, 9, 1, NULL),
(10, 10, 1, NULL),
(11, 11, 1, NULL),
(12, 12, 1, NULL),
(13, 1, 2, NULL);

CREATE TABLE `Sun` (
  `sunID` int(3) NOT NULL,
  `zodiacID` int(3) NOT NULL,
  `houseID` int(3) NOT NULL,
  `sunDesc` varchar(255) NOT NULL,
  `sunPitch` varchar(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

INSERT INTO `Sun` (`sunID`, `zodiacID`, `houseID`, `sunDesc`, `sunPitch`) VALUES
(1, 1, 1, 'this text describes what it means to have your sun sign be ARIES and also in your FIRST house', 'this text descibes what sun in ARIES/1st house sounds like'),
(2, 2, 1, 'this text describes what it means to have your sun sign be TAURUS\r\n and also in your first house', ''),
(3, 3, 1, 'this text describes what it means to have your sun sign be GEMINI\r\n and also in your first house', ''),
(4, 4, 1, '', ''),
(5, 5, 1, '', ''),
(6, 6, 1, '', ''),
(7, 7, 1, '', ''),
(8, 8, 1, '', ''),
(9, 9, 1, '', ''),
(10, 10, 1, '', ''),
(11, 11, 1, '', ''),
(12, 12, 1, '', ''),
(13, 1, 2, 'this text describes what it means to have your sun sign be ARIES and also in your SECOND house', 'this text descibes what sun in ARIES/1st house sounds like'),
(14, 2, 2, 'this text describes what it means to have your sun sign be TAURUS\r\n and also in your second house', ''),
(15, 3, 2, 'this text describes what it means to have your sun sign be GEMINI\r\n and also in your second house', ''),
(16, 4, 2, '', ''),
(17, 5, 2, '', ''),
(18, 6, 2, '', ''),
(19, 7, 2, '', ''),
(20, 8, 2, '', ''),
(21, 9, 2, '', ''),
(22, 10, 2, '', ''),
(23, 11, 2, '', ''),
(24, 12, 2, '', ''),
(25, 1, 3, 'this text describes what it means to have your sun sign be ARIES and also in your THIRD house', 'this text descibes what sun in ARIES/1st house sounds like'),
(26, 2, 3, 'this text describes what it means to have your sun sign be TAURUS\r\n and also in your THIRD house', ''),
(27, 3, 3, 'this text describes what it means to have your sun sign be GEMINI\r\n and also in your first house', ''),
(28, 4, 3, '', ''),
(29, 5, 3, '', ''),
(30, 6, 3, '', ''),
(31, 7, 3, '', ''),
(32, 8, 3, '', ''),
(33, 9, 3, '', ''),
(34, 10, 3, '', ''),
(35, 11, 3, '', ''),
(36, 12, 3, '', ''),
(37, 1, 4, 'this text describes what it means to have your sun sign be ARIES and also in your FOURTH house', 'this text descibes what sun in ARIES/1st house sounds like'),
(38, 2, 4, 'this text describes what it means to have your sun sign be TAURUS\r\n and also in your second house', ''),
(39, 3, 4, 'this text describes what it means to have your sun sign be GEMINI\r\n and also in your second house', ''),
(40, 4, 4, 'CANCER SUN in 4th HOUSE', ''),
(41, 5, 4, '', ''),
(42, 6, 4, '', ''),
(43, 7, 4, '', ''),
(44, 8, 4, '', ''),
(45, 9, 4, '', ''),
(46, 10, 4, '', ''),
(47, 11, 4, '', ''),
(48, 12, 4, '', ''),
(49, 1, 5, '', ''),
(50, 2, 5, '', ''),
(51, 3, 5, '', ''),
(52, 4, 5, '', ''),
(53, 5, 5, '', ''),
(54, 6, 5, '', ''),
(55, 7, 5, '', ''),
(56, 8, 5, '', ''),
(57, 9, 5, '', ''),
(58, 10, 5, '', ''),
(59, 11, 5, '', ''),
(60, 12, 5, '', ''),
(61, 1, 6, '', ''),
(62, 2, 6, '', ''),
(63, 3, 6, '', ''),
(64, 4, 6, '', ''),
(65, 5, 6, '', ''),
(66, 6, 6, '', ''),
(67, 7, 6, '', ''),
(68, 8, 6, '', ''),
(69, 9, 6, '', ''),
(70, 10, 6, '', ''),
(71, 11, 6, '', ''),
(72, 12, 6, '', ''),
(73, 1, 7, '', ''),
(74, 2, 7, '', ''),
(75, 3, 7, '', ''),
(76, 4, 7, '', ''),
(77, 5, 7, '', ''),
(78, 6, 7, '', ''),
(79, 7, 7, '', ''),
(80, 8, 7, '', ''),
(81, 9, 7, '', ''),
(82, 10, 7, '', ''),
(83, 11, 7, '', ''),
(84, 12, 7, '', ''),
(85, 1, 8, '', ''),
(86, 2, 8, '', ''),
(87, 3, 8, '', ''),
(88, 4, 8, '', ''),
(89, 5, 8, '', ''),
(90, 6, 8, '', ''),
(91, 7, 8, '', ''),
(92, 8, 8, '', ''),
(93, 9, 8, '', ''),
(94, 10, 8, '', ''),
(95, 11, 8, '', ''),
(96, 12, 8, '', ''),
(97, 1, 9, 'sun in aries, 9th house', 'aries = A, house = timbre (9th house: travel, philosophy)'),
(98, 2, 9, '', ''),
(99, 3, 9, '', ''),
(100, 4, 9, '', ''),
(101, 5, 9, '', ''),
(102, 6, 9, '', ''),
(103, 7, 9, '', ''),
(104, 8, 9, '', ''),
(105, 9, 9, '', ''),
(106, 10, 9, '', ''),
(107, 11, 9, '', ''),
(108, 12, 9, '', ''),
(109, 1, 10, '', ''),
(110, 2, 10, '', ''),
(111, 3, 10, '', ''),
(112, 4, 10, '', ''),
(113, 5, 10, '', ''),
(114, 6, 10, '', ''),
(115, 7, 10, '', ''),
(116, 8, 10, '', ''),
(117, 9, 10, '', ''),
(118, 10, 10, '', ''),
(119, 11, 10, '', ''),
(120, 12, 10, '', ''),
(121, 1, 11, '', ''),
(122, 2, 11, '', ''),
(123, 3, 11, '', ''),
(124, 4, 11, '', ''),
(125, 5, 11, '', ''),
(126, 6, 11, '', ''),
(127, 7, 11, '', ''),
(128, 8, 11, '', ''),
(129, 9, 11, '', ''),
(130, 10, 11, '', ''),
(131, 11, 11, '', ''),
(132, 12, 11, '', ''),
(133, 1, 12, '', ''),
(134, 2, 12, '', ''),
(135, 3, 12, '', ''),
(136, 4, 12, '', ''),
(137, 5, 12, '', ''),
(138, 6, 12, '', ''),
(139, 7, 12, '', ''),
(140, 8, 12, '', ''),
(141, 9, 12, '', ''),
(142, 10, 12, '', ''),
(143, 11, 12, '', ''),
(144, 12, 12, '', '');

CREATE TABLE `User` (
  `userID` int(11) NOT NULL,
  `userName` varchar(255) NOT NULL,
  `email` varchar(255) NOT NULL,
  `birthTime` datetime DEFAULT NULL,
  `sunID` int(3) DEFAULT NULL,
  `moonID` int(3) DEFAULT NULL,
  `ascID` int(3) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

INSERT INTO `User` (`userID`, `userName`, `email`, `birthTime`, `sunID`, `moonID`, `ascID`) VALUES
(1, 'crick', '', '2021-04-27 19:55:28', 33, NULL, NULL),
(2, 'qwerty', 'qwerty@aol.com', '1999-04-27 21:14:39', 44, NULL, NULL),
(3, '@christopherstrickland66', 'cmstrickland@gmail.com', '1982-04-04 12:36:00', 97, 6, 5);

CREATE TABLE `Zodiac` (
  `zodiacID` int(2) NOT NULL,
  `zodiacName` varchar(255) NOT NULL,
  `pitch` varchar(6) NOT NULL,
  `frequency` float(11,2) NOT NULL,
  `element` varchar(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

INSERT INTO `Zodiac` (`zodiacID`, `zodiacName`, `pitch`, `frequency`, `element`) VALUES
(1, 'Aries', 'A', 440.00, 'fire'),
(2, 'Taurus', 'A#/Bb', 466.16, 'earth'),
(3, 'Gemini', 'B', 493.88, 'air'),
(4, 'Cancer', 'C', 523.25, 'water'),
(5, 'Leo', 'C#/Db', 554.37, 'fire'),
(6, 'Virgo', 'D', 587.33, 'earth'),
(7, 'Libra', 'D#/Eb', 622.25, 'air'),
(8, 'Scorpio', 'E', 659.25, 'water'),
(9, 'Sagittarius', 'F', 698.46, 'fire'),
(10, 'Capricorn', 'F#/Gb', 739.99, 'earth'),
(11, 'Aquarius', 'G', 783.99, 'air'),
(12, 'Pisces', 'G#/Ab', 830.61, 'water');

ALTER TABLE `Ascendant`
  ADD PRIMARY KEY (`ascID`),
  ADD KEY `zodiacID` (`zodiacID`,`houseID`),
  ADD KEY `houseID` (`houseID`);

ALTER TABLE `House`
  ADD PRIMARY KEY (`houseID`);

ALTER TABLE `Moon`
  ADD PRIMARY KEY (`moonID`),
  ADD KEY `zodiacID` (`zodiacID`,`houseID`),
  ADD KEY `houseID` (`houseID`);

ALTER TABLE `Sun`
  ADD PRIMARY KEY (`sunID`),
  ADD KEY `zodiacID` (`zodiacID`,`houseID`),
  ADD KEY `houseID` (`houseID`);

ALTER TABLE `User`
  ADD PRIMARY KEY (`userID`),
  ADD UNIQUE KEY `userName` (`userName`),
  ADD UNIQUE KEY `email` (`email`),
  ADD KEY `sunID` (`sunID`,`moonID`,`ascID`),
  ADD KEY `moonID` (`moonID`),
  ADD KEY `ascID` (`ascID`);

ALTER TABLE `Zodiac`
  ADD PRIMARY KEY (`zodiacID`);

ALTER TABLE `Ascendant`
  ADD CONSTRAINT `ascendant_ibfk_1` FOREIGN KEY (`zodiacID`) REFERENCES `Zodiac` (`zodiacID`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  ADD CONSTRAINT `ascendant_ibfk_2` FOREIGN KEY (`houseID`) REFERENCES `House` (`houseID`) ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE `Moon`
  ADD CONSTRAINT `moon_ibfk_2` FOREIGN KEY (`zodiacID`) REFERENCES `Zodiac` (`zodiacID`),
  ADD CONSTRAINT `moon_ibfk_3` FOREIGN KEY (`houseID`) REFERENCES `House` (`houseID`);

ALTER TABLE `Sun`
  ADD CONSTRAINT `sun_ibfk_1` FOREIGN KEY (`houseID`) REFERENCES `House` (`houseID`),
  ADD CONSTRAINT `sun_ibfk_2` FOREIGN KEY (`zodiacID`) REFERENCES `Zodiac` (`zodiacID`);

ALTER TABLE `User`
  ADD CONSTRAINT `user_ibfk_1` FOREIGN KEY (`sunID`) REFERENCES `Sun` (`sunID`),
  ADD CONSTRAINT `user_ibfk_2` FOREIGN KEY (`moonID`) REFERENCES `Moon` (`moonID`) ON DELETE NO ACTION ON UPDATE CASCADE,
  ADD CONSTRAINT `user_ibfk_3` FOREIGN KEY (`ascID`) REFERENCES `Ascendant` (`ascID`) ON DELETE NO ACTION ON UPDATE NO ACTION;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
