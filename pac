#!/usr/bin/env python3

"""
pac - wrapper around pacaur to mimic yaourts search feature

Usage:
  pac
  pac <search_pattern>...
  pac (-a | --autoremove)
  pac (-h | --help)
  pac (-v | --version)
  pac <pacaur arguments>...

Options:
  -a, --autoremove  Removes orphan packages
  -h, --help        Display this help
  -v, --version     Display version information

Invoking pac without arguments is equivalent to 'pacaur -Syu'.

https://github.com/XenGi/pac
"""

__author__ = 'Ricardo Band'
__copyright__ = 'Copyright 2017, Ricardo band'
__credits__ = ['Ricardo Band']
__license__ = 'MIT'
__version__ = '1.3.1'
__maintainer__ = 'Ricardo Band'
__email__ = 'email@ricardo.band'

import sys
from typing import List
from subprocess import call, run, PIPE


def search(search_term: str) -> List[dict]:
    """
    Search for the given terms using pacaur and return the results. The output of pacaur looks like this:

    $ pacaur -Ss android
    extra/gvfs-mtp 1.30.3-1 (gnome) [installed]
        Virtual filesystem implementation for GIO (MTP backend; Android, media player)
    community/android-file-transfer 3.0-2
        Android MTP client with minimalistic UI
    aur/android-studio 2.2.3.0-1 (626, 22.50) [installed]
        The official Android IDE (Stable branch)
    aur/android-ndk r13b-1 (252, 3.70)
        Android C/C++ developer kit

    A result consists of 2 lines. The second one is the package description. The first one goes like this (paranthesis
    means optional):
    repo/package_name version [package_group] [installed_state] [votes]

    - repo is the name of the repository and can be any string configured in /etc/pacman.conf like 'core', 'extra', 'aur',
    'myrepo'
    - package name is the identifiing string of the package
    - version can be any string but will most likely be something like 1.2.3-2
    - package group is a string in brackets
    - if the package is already installed the line has the string '[installed]' in it
    - if the repo is the aur the line will have the votes which look like '(252, 3.70)'

    The important part here is the package name because we need that to install the packages afterwards.
    We also put everything else in a dict to make the output more colorful.
    """
    result: List[dict] = []
    out: str = run(['pacaur', '-Ss', search_term], stdout=PIPE).stdout.decode()
    entry: dict = {}

    for line in out.split('\n'):
        if line.startswith(' '):
            entry['description'] = line.strip()
            result.append(entry)
            # create a new entry
            entry = {}
        elif line != '':
            l = line.split('/')
            entry['repo'] = l[0]
            l = l[1].split(' ')
            entry['package'] = l[0]
            entry['version'] = l[1]
            entry['votes'] = None
            entry['group'] = None
            entry['installed'] = None
            if len(l) > 2 and l[2].startswith('('):
                if l[2].endswith(')'):
                    entry['group'] = l[2]
                else:
                    entry['votes'] = '%s %s' % (l[2], l[3])
            if len(l) > 3 and l[3].startswith('('):
                if l[3].endswith(')'):
                    entry['group'] = l[3]
                else:
                    entry['votes'] = '%s %s' % (l[3], l[4])
            if '[installed]' in l:
                entry['installed'] = '[installed]'
    return result


def present(entries: List[dict]):
    """
    Present the list of entries with numbers in front of it. For each package it displays 2 lines like this:

    1   extra/gvfs-mtp 1.30.3-1 (gnome) [installed]
        Virtual filesystem implementation for GIO (MTP backend; Android, media player)
    2   community/android-file-transfer 3.0-2
        Android MTP client with minimalistic UI
    3   aur/android-studio 2.2.3.0-1 [installed] (626, 22.50)
        The official Android IDE (Stable branch)
    4   aur/android-ndk r13b-1 (252, 3.70)
        Android C/C++ developer kit

    After that, a prompt will be printed but this is the task for another function.
    """
    CEND: str = '\33[0m'
    CBOLD: str = '\33[1m'
    CBLACK: str = '\33[30m'
    CVIOLET: str = '\33[35m'
    CGREEN2: str = '\33[92m'
    CYELLOW2: str = '\33[93m'
    CVIOLET2: str = '\33[95m'
    CYELLOWBG: str = '\33[43m'
    CYELLOWBG2: str = '\33[103m'

    # TODO: based on the maximum length of the index prepend spaces
    #  999 core/foo
    #      Some text.
    # 1000 aur/bar
    #      Some more text.

    for index, entry in enumerate(entries):
        print(f"{CBLACK}{CYELLOWBG}{index + 1}{CEND} {CVIOLET2}{entry['repo']}/{CEND}{CBOLD}{entry['package']}{CEND} {CGREEN2}{entry['version']}{CEND}", end='')
        if entry['group']:
            print(f" {entry['group']}", end='')
        if entry['installed']:
            print(f" {CBLACK}{CYELLOWBG2}{entry['installed']}{CEND}", end='')
        if entry['votes']:
            print(f" {CBLACK}{CYELLOWBG2}{entry['votes']}{CEND}", end='')
        print(f"\n    {entry['description']}")
    print(f"{CYELLOW2}==>{CEND} {CBOLD}Enter n° of packages to be installed (ex: 1 2 3 or 1-3){CEND}")
    print(f"{CYELLOW2}==>{CEND} {CBOLD}-------------------------------------------------------{CEND}")


def parse_num(numbers: str) -> List[int]:
    """
    Takes a string like '1 2 3 6-8' and finds out which numbers the user wants. In this case 1,2,3,6,7,8.
    It can detect single digits or ranges seperated by space. A range must be given as from-to, where 'from' is always
    smaller then 'to'.
    """
    result = []
    for n in numbers.split(' '):
        if '-' in n:
            start, end = n.split('-')
            if not (start.isdecimal() and end.isdecimal()):
                sys.exit(f'{start} or {end} is not a number')
            # TODO: I'm pretty sure this can be optimized
            for i in list(range(int(start) - 1, int(end))):
                result.append(i)
        elif n.isdecimal():
            result.append(int(n) - 1)
        else:
            sys.exit(f'{n} is not a number')

    return result


def install(numbers: List[int], packages: List[dict]):
    """
    Gets the chosen packages and concatinates them. Then executes the pacaur command with the packages to install them.
    """
    names = [packages[i]['package'] for i in numbers]
    call(f"pacaur -S {' '.join(names)}", shell=True)


def autoremove():
    """
    """
    orphans: List[str] = run(['pacaur', '-Qdtq'], stdout=PIPE).stdout.decode().split('\n')
    if orphans != ['', ]:
        args = ['pacaur', '-Rs']
        args.extend(orphans)
        call(args)


if __name__ == '__main__':
    if len(sys.argv) > 1:
        if '-h' in sys.argv[1:] or '--help' in sys.argv[1:]:
            print(__doc__)
        elif '-v' in sys.argv[1:] or '--version' in sys.argv[1:]:
            print('pac v%s' % __version__)
        elif '-a' in sys.argv[1:] or '--autoremove' in sys.argv[1:]:
            autoremove()
        elif sys.argv[1][:2] in ['-D', '-F', '-Q', '-R', '-S', '-T', '-U']:
            call(f"pacaur {' '.join(sys.argv[1:])}", shell=True)
        else:
            try:
                entries = search(' '.join(sys.argv[1:]))
                present(entries)
                numbers = parse_num(input('\33[93m==>\33[0m '))
                install(numbers, entries)
            except KeyboardInterrupt:
                pass
    else:
        call('pacaur -Syu', shell=True)

