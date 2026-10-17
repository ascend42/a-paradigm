#!/usr/bin/env node
import { runPlaceholderBin } from './placeholder.js';

process.exitCode = runPlaceholderBin('gnomond', process.argv.slice(2));
