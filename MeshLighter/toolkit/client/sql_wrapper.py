import sqlite3

class sqlwrapper():
    def __init__(self):
        self.users = sqlite3.connect('radios.db')
        cursor = self.users.cursor()
        cursor.execute('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=\'radios\';')
        if len(cursor.fetchall()) == 0:
            cursor.execute('CREATE TABLE radios(address, longname, shortname, key);')
            
    def add_user(self,username):
        cursor = self.users.cursor()
        
    def save(self):
        pass
