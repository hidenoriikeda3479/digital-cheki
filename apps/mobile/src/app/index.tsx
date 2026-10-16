import { StyleSheet, View } from 'react-native';

import { AuthScreen } from '@/features/auth/auth-screen';
import { useAppServices } from '@/services/provider';

export default function HomeScreen() {
  const { auth, identification, capture, editing, finishedImage, upload, download,
    enrollment, password, mockPasswordInbox, support, photoManagement } = useAppServices();
  return <View style={styles.page}>
    <AuthScreen auth={auth} identification={identification} capture={capture} editing={editing} finishedImage={finishedImage}
      upload={upload} download={download} enrollment={enrollment}
      passwordService={password} mockPasswordInbox={mockPasswordInbox} support={support} photoManagement={photoManagement} />
  </View>;
}

const styles = StyleSheet.create({ page: { flex: 1, backgroundColor: '#ffffff' } });
