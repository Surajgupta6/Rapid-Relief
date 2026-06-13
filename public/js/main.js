// Handle logout
document.addEventListener('DOMContentLoaded', function() {
  const logoutLinks = document.querySelectorAll('a[href="/auth/logout"]');
  
  logoutLinks.forEach(link => {
    link.addEventListener('click', async function(e) {
      e.preventDefault();
      
      try {
        const response = await fetch('/auth/logout', {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json'
          }
        });
        
        const data = await response.json();
        
        if (response.ok) {
          // Show success popup
          const popup = document.createElement('div');
          popup.className = 'alert alert-success position-fixed top-0 start-50 translate-middle-x mt-3';
          popup.style.zIndex = '9999';
          popup.textContent = data.message;
          
          document.body.appendChild(popup);
          
          // Remove popup after 3 seconds
          setTimeout(() => {
            popup.remove();
            // Redirect to register page
            window.location.href = '/register';
          }, 3000);
        }
      } catch (err) {
        console.error('Logout error:', err);
      }
    });
  });
}); 