#!/usr/bin/env node
import { runPlaceholderBin } from './placeholder.js';

process.exitCode = runPlaceholderBin('gnomon', process.argv.slice(2));
